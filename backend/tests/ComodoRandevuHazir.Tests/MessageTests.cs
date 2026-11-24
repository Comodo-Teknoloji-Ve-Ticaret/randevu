using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>
/// Mesaj kayıtları. Mesajlar yalnız WhatsApp ile (salonun telefonundan, elle) gönderilir; sunucu kaydı tutar
/// ve izinleri denetler: hizmet mesajı için ileti izni, kampanya mesajı için açık rıza.
/// </summary>
public class MessageTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Msg(string id, string customerId, string channel = "whatsapp", string to = "5329999999", string body = "Hatırlatma: yarın 10:30", string kind = "reminder") =>
        new { id, customerId, kind, channel, to, body, status = "opened", at = "2026-11-24T09:00:00Z" };

    private async Task<(HttpStatusCode Code, string Title)> Send(object[] upserts, object[]? deletes = null)
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts, deletes = deletes ?? [] });
        var body = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    private static object Up(object data, string collection = "messages") => new { collection, data };

    private async Task<JsonObject> Stored(string id)
    {
        var db = await (await app.LoginAsync("ayse@test.local")).GetFromJsonAsync<JsonObject>("/api/sync");
        return db!["messages"]!.AsArray().OfType<JsonObject>().First(m => m["id"]!.GetValue<string>() == id);
    }

    private static void Expect((HttpStatusCode Code, string Title) r, HttpStatusCode code, string? title = null)
    {
        Assert.True(r.Code == code, $"{(int)r.Code}: {r.Title}");
        if (title is not null) Assert.StartsWith(title, r.Title);
    }

    [Fact]
    public async Task Whatsapp_log_uses_the_customers_own_number()
    {
        Expect(await Send([Up(Msg("ml_1", "m_a1"))]), HttpStatusCode.OK);
        var stored = await Stored("ml_1");
        Assert.Equal("5321112233", stored["to"]!.GetValue<string>());
        Assert.Equal("opened", stored["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Sms_channel_is_no_longer_accepted()
    {
        Expect(await Send([Up(Msg("ml_s1", "m_a1", channel: "sms"))]), HttpStatusCode.BadRequest, "Mesaj geçersiz");
    }

    [Fact]
    public async Task Service_message_needs_customer_consent()
    {
        // m_a2: ileti izni yok
        Expect(await Send([Up(Msg("ml_2", "m_a2"))]), HttpStatusCode.BadRequest, "Müşterinin ileti izni yok");
    }

    [Fact]
    public async Task Campaign_message_needs_explicit_marketing_consent()
    {
        // m_a1: ileti (hatırlatma) izni var, kampanya için açık rızası yok
        Expect(await Send([Up(Msg("ml_c1", "m_a1", kind: "birthday", body: "İyi ki doğdun!"))]), HttpStatusCode.BadRequest, "Müşterinin kampanya mesajı için açık rızası yok");
        Expect(await Send([Up(new { id = "m_a1", name = "Elif", phone = "5321112233", consentSms = true, consentMarketing = true }, "customers")]), HttpStatusCode.OK);
        Expect(await Send([Up(Msg("ml_c2", "m_a1", kind: "birthday", body: "İyi ki doğdun!"))]), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Message_log_is_append_only()
    {
        Expect(await Send([Up(Msg("ml_4", "m_a1"))]), HttpStatusCode.OK);
        Expect(await Send([Up(Msg("ml_4", "m_a1", body: "değişti"))]), HttpStatusCode.Conflict, "Gönderilmiş mesaj değiştirilemez");
        Expect(await Send([], [new { collection = "messages", id = "ml_4" }]), HttpStatusCode.Conflict, "Gönderilmiş mesaj");
    }

    [Fact]
    public async Task Invalid_messages_and_templates_are_rejected()
    {
        Expect(await Send([Up(Msg("ml_5", "m_a1", body: new string('a', 1000)))]), HttpStatusCode.BadRequest, "Mesaj geçersiz");
        Expect(await Send([Up(Msg("ml_6", "m_yok"))]), HttpStatusCode.BadRequest, "Müşteri bulunamadı");
        Expect(await Send([Up(new { id = "ml_7", kind = "reminder", channel = "whatsapp", to = "5321112233", body = "Merhaba", status = "opened", at = "2026-11-24T09:00:00Z" })]), HttpStatusCode.BadRequest, "Mesaj için müşteri gerekli");
        Expect(await Send([Up(new { id = "tp_x", kind = "spam", name = "X", body = "Merhaba", enabled = true }, "templates")]), HttpStatusCode.BadRequest, "Şablon geçersiz");
        Expect(await Send([Up(new { id = "tp_ok", kind = "reminder", name = "Hatırlatma", body = "Merhaba {musteri}", enabled = true }, "templates")]), HttpStatusCode.OK);
    }
}
