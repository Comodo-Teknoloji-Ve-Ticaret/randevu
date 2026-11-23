using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Application;

namespace ComodoRandevuHazir.Infrastructure.Messaging;

/// <summary>
/// Sms:Provider = simulation (varsayılan) | netgsm | iletimerkezi
/// Sms:Sender: BTK onaylı gönderici adı (başlık). Netgsm: Username + Password. İleti Merkezi: ApiKey + ApiHash (panelden).
/// </summary>
public class SmsOptions
{
    public string Provider { get; set; } = "simulation";
    public string Sender { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string ApiHash { get; set; } = "";
    /// <summary>Netgsm REST v2'de kampanya/kutlama mesajlarının İYS filtresi (bireysel alıcı). Netgsm ile doğrulayın.</summary>
    public string NetgsmIysFilter { get; set; } = "11";
}

/// <summary>Netgsm REST v2: POST /sms/rest/v2/send, Basic kimlik doğrulama; başarı code = "00".</summary>
public class NetgsmSmsSender(HttpClient http, SmsOptions o) : ISmsSender
{
    public const string Url = "https://api.netgsm.com.tr/sms/rest/v2/send";

    private static readonly Dictionary<string, string> Errors = new()
    {
        ["20"] = "Mesaj metni hatalı ya da çok uzun.",
        ["30"] = "Netgsm kullanıcı adı/şifresi hatalı ya da API erişimi kapalı (IP kısıtı olabilir).",
        ["40"] = "Gönderici adı (başlık) Netgsm'de tanımlı değil.",
        ["50"] = "Hesap İYS kontrollü gönderim yapamıyor.",
        ["51"] = "Hesapta İYS marka bilgisi yok.",
        ["70"] = "Netgsm isteği hatalı (eksik/yanlış alan).",
        ["80"] = "Netgsm gönderim hız sınırı aşıldı.",
        ["85"] = "Aynı numaraya 1 dakikada çok fazla gönderim.",
    };

    public string LogStatus => "queued";

    public async Task<SmsResult> SendAsync(OutgoingSms sms, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["msgheader"] = o.Sender,
            ["encoding"] = "TR",
            ["messages"] = new JsonArray(new JsonObject { ["msg"] = sms.Body, ["no"] = sms.To }),
        };
        if (sms.Commercial && o.NetgsmIysFilter.Length > 0) body["iysfilter"] = o.NetgsmIysFilter;
        using var req = new HttpRequestMessage(HttpMethod.Post, Url) { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{o.Username}:{o.Password}")));
        try
        {
            using var res = await http.SendAsync(req, ct);
            var json = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct)) as JsonObject;
            var code = json?["code"]?.ToString();
            if (code == "00") return new SmsResult(true, json?["jobid"]?.ToString(), null);
            return new SmsResult(false, null, code is not null && Errors.TryGetValue(code, out var e) ? e : $"Netgsm hata kodu {code ?? ((int)res.StatusCode).ToString()}.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return new SmsResult(false, null, "Netgsm'e ulaşılamadı.");
        }
    }
}

/// <summary>İleti Merkezi: POST /v1/send-sms/json; kimlik gövdede (key + panelin verdiği hash); başarı status.code = 200.</summary>
public class IletiMerkeziSmsSender(HttpClient http, SmsOptions o) : ISmsSender
{
    public const string Url = "https://api.iletimerkezi.com/v1/send-sms/json";

    public string LogStatus => "queued";

    public async Task<SmsResult> SendAsync(OutgoingSms sms, CancellationToken ct)
    {
        var order = new JsonObject
        {
            ["sender"] = o.Sender,
            ["iys"] = sms.Commercial ? "1" : "0", // hizmet mesajı (hatırlatma/onay) İYS dışı
            ["message"] = new JsonObject
            {
                ["text"] = sms.Body,
                ["receipents"] = new JsonObject { ["number"] = new JsonArray("90" + sms.To) }, // belgede bu yazımla
            },
        };
        if (sms.Commercial) order["iysList"] = "BIREYSEL";
        var body = new JsonObject { ["request"] = new JsonObject { ["authentication"] = new JsonObject { ["key"] = o.ApiKey, ["hash"] = o.ApiHash }, ["order"] = order } };
        try
        {
            using var res = await http.PostAsJsonAsync(Url, body, ct);
            var json = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct));
            var status = json?["response"]?["status"];
            var code = status?["code"]?.GetValue<int>() ?? (int)res.StatusCode;
            if (code == 200) return new SmsResult(true, json?["response"]?["order"]?["id"]?.ToString(), null);
            return new SmsResult(false, null, $"İleti Merkezi: {status?["message"]?.GetValue<string>() ?? "hata"} ({code})");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or InvalidOperationException)
        {
            return new SmsResult(false, null, "İleti Merkezi'ne ulaşılamadı.");
        }
    }
}
