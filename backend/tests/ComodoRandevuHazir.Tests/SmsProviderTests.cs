using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure.Messaging;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace ComodoRandevuHazir.Tests;

/// <summary>Sahte HTTP katmanı: giden isteği kaydeder, verilen yanıtı döner.</summary>
public sealed class FakeHttp(HttpStatusCode status, string body) : HttpMessageHandler
{
    public HttpRequestMessage? Request;
    public string? RequestBody;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Request = request;
        RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }
}

public class NetgsmSenderTests
{
    private static (NetgsmSmsSender Sender, FakeHttp Http) Make(string response, HttpStatusCode status = HttpStatusCode.OK)
    {
        var http = new FakeHttp(status, response);
        return (new NetgsmSmsSender(new HttpClient(http), new SmsOptions { Sender = "SALONHDR", Username = "8501234567", Password = "gizli" }), http);
    }

    [Fact]
    public async Task Posts_rest_v2_with_basic_auth_and_turkish_encoding()
    {
        var (s, http) = Make("""{"code":"00","jobid":"17377215342605050417149344","description":"queued"}""");
        var r = await s.SendAsync(new OutgoingSms("ml_1", "t_a", "5321112233", "Hatırlatma: yarın 10:30", Commercial: false), default);

        Assert.Equal((true, "17377215342605050417149344"), (r.Ok, r.ProviderRef));
        Assert.Equal("https://api.netgsm.com.tr/sms/rest/v2/send", http.Request!.RequestUri!.ToString());
        Assert.Equal(HttpMethod.Post, http.Request.Method);
        Assert.Equal("Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("8501234567:gizli")), http.Request.Headers.Authorization!.ToString());
        var body = JsonNode.Parse(http.RequestBody!)!;
        Assert.Equal(("SALONHDR", "TR"), (body["msgheader"]!.GetValue<string>(), body["encoding"]!.GetValue<string>()));
        Assert.Equal(("Hatırlatma: yarın 10:30", "5321112233"), (body["messages"]![0]!["msg"]!.GetValue<string>(), body["messages"]![0]!["no"]!.GetValue<string>()));
        Assert.Null(body["iysfilter"]); // hizmet mesajı İYS filtresine girmez
    }

    [Fact]
    public async Task Commercial_message_carries_iys_filter()
    {
        var (s, http) = Make("""{"code":"00","jobid":"1"}""");
        await s.SendAsync(new OutgoingSms("ml_2", "t_a", "5321112233", "Doğum gününüz kutlu olsun!", Commercial: true), default);
        Assert.Equal("11", JsonNode.Parse(http.RequestBody!)!["iysfilter"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("40", "Gönderici adı")]
    [InlineData("30", "Netgsm kullanıcı")]
    public async Task Error_codes_become_readable_failures(string code, string message)
    {
        var (s, _) = Make($$"""{"code":"{{code}}","description":"x"}""");
        var r = await s.SendAsync(new OutgoingSms("ml_3", "t_a", "5321112233", "x", false), default);
        Assert.False(r.Ok);
        Assert.StartsWith(message, r.Error);
    }

    [Fact]
    public async Task Network_failure_does_not_throw()
    {
        var s = new NetgsmSmsSender(new HttpClient(new ThrowingHttp()), new SmsOptions { Sender = "X", Username = "u", Password = "p" });
        var r = await s.SendAsync(new OutgoingSms("ml_4", "t_a", "5321112233", "x", false), default);
        Assert.False(r.Ok);
    }

    private sealed class ThrowingHttp : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => throw new HttpRequestException("bağlantı yok");
    }
}

public class IletiMerkeziSenderTests
{
    private static (IletiMerkeziSmsSender Sender, FakeHttp Http) Make(string response, HttpStatusCode status = HttpStatusCode.OK)
    {
        var http = new FakeHttp(status, response);
        return (new IletiMerkeziSmsSender(new HttpClient(http), new SmsOptions { Sender = "SALONHDR", ApiKey = "KEY", ApiHash = "HASH" }), http);
    }

    [Fact]
    public async Task Posts_documented_json_envelope()
    {
        var (s, http) = Make("""{"response":{"status":{"code":200,"message":"İşlem başarılı"},"order":{"id":"312891245"}}}""");
        var r = await s.SendAsync(new OutgoingSms("ml_1", "t_a", "5321112233", "Hatırlatma", Commercial: false), default);

        Assert.Equal((true, "312891245"), (r.Ok, r.ProviderRef));
        Assert.Equal("https://api.iletimerkezi.com/v1/send-sms/json", http.Request!.RequestUri!.ToString());
        var req = JsonNode.Parse(http.RequestBody!)!["request"]!;
        Assert.Equal(("KEY", "HASH"), (req["authentication"]!["key"]!.GetValue<string>(), req["authentication"]!["hash"]!.GetValue<string>()));
        var order = req["order"]!;
        Assert.Equal(("SALONHDR", "0"), (order["sender"]!.GetValue<string>(), order["iys"]!.GetValue<string>()));
        Assert.Equal("Hatırlatma", order["message"]!["text"]!.GetValue<string>());
        Assert.Equal("905321112233", order["message"]!["receipents"]!["number"]![0]!.GetValue<string>()); // belgedeki yazım: "receipents"
    }

    [Fact]
    public async Task Commercial_message_is_iys_individual()
    {
        var (s, http) = Make("""{"response":{"status":{"code":200,"message":"ok"},"order":{"id":"1"}}}""");
        await s.SendAsync(new OutgoingSms("ml_2", "t_a", "5321112233", "Kampanya", Commercial: true), default);
        var order = JsonNode.Parse(http.RequestBody!)!["request"]!["order"]!;
        Assert.Equal(("1", "BIREYSEL"), (order["iys"]!.GetValue<string>(), order["iysList"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Auth_error_is_a_readable_failure()
    {
        var (s, _) = Make("""{"response":{"status":{"code":401,"message":"Üyelik bilgileri hatalı"}}}""", HttpStatusCode.Unauthorized);
        var r = await s.SendAsync(new OutgoingSms("ml_3", "t_a", "5321112233", "x", false), default);
        Assert.Equal((false, "İleti Merkezi: Üyelik bilgileri hatalı (401)"), (r.Ok, r.Error));
    }
}

/// <summary>Gerçek sağlayıcıyla gönderim başarısız olunca mesaj kaydı "iletilemedi" olur; kullanıcının işlemi bozulmaz.</summary>
public class FailingSmsApp : TestApp
{
    public sealed class Failing : ISmsSender
    {
        public string LogStatus => "queued";
        public Task<SmsResult> SendAsync(OutgoingSms sms, CancellationToken ct) => Task.FromResult(new SmsResult(false, null, "Gönderici adı onaylı değil."));
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddSingleton<ISmsSender, Failing>());
    }
}

public class SmsDeliveryStatusTests(FailingSmsApp app) : IClassFixture<FailingSmsApp>
{
    [Fact]
    public async Task Failed_delivery_is_recorded_on_the_message()
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection = "messages", data = new { id = "ml_f", customerId = "m_a1", kind = "reminder", channel = "sms", to = "", body = "Hatırlatma", status = "simulated", at = "2026-11-24T09:00:00Z" } } } });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var db = await c.GetFromJsonAsync<JsonObject>("/api/sync");
        var m = db!["messages"]!.AsArray().OfType<JsonObject>().First(x => x["id"]!.GetValue<string>() == "ml_f");
        Assert.Equal(("failed", "Gönderici adı onaylı değil."), (m["status"]!.GetValue<string>(), m["error"]!.GetValue<string>()));
    }
}
