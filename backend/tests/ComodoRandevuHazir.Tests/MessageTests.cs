using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure.Messaging;
using Microsoft.Extensions.DependencyInjection;

namespace ComodoRandevuHazir.Tests;

/// <summary>Mesaj kayıtları ve SMS gönderimi (şimdilik simülasyon sağlayıcısı).</summary>
public class MessageTests(TestApp app) : IClassFixture<TestApp>
{
    private SimulatedSmsSender Sms => (SimulatedSmsSender)app.Services.GetRequiredService<ISmsSender>();

    private static object Msg(string id, string customerId, string channel = "sms", string to = "5329999999", string body = "Hatırlatma: yarın 10:30") =>
        new { id, customerId, kind = "reminder", channel, to, body, status = "simulated", at = "2026-11-24T09:00:00Z" };

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
    public async Task Sms_goes_only_to_the_customers_own_number()
    {
        Expect(await Send([Up(Msg("ml_1", "m_a1"))]), HttpStatusCode.OK);
        Assert.Equal("5321112233", (await Stored("ml_1"))["to"]!.GetValue<string>());
        Assert.Contains(Sms.Sent, s => s.To == "5321112233" && s.Body == "Hatırlatma: yarın 10:30");
        Assert.DoesNotContain(Sms.Sent, s => s.To == "5329999999");
    }

    [Fact]
    public async Task Sms_needs_customer_consent_but_manual_whatsapp_does_not()
    {
        Expect(await Send([Up(Msg("ml_2", "m_a2"))]), HttpStatusCode.BadRequest, "Müşterinin ileti izni yok");
        Expect(await Send([Up(Msg("ml_3", "m_a2", channel: "whatsapp"))]), HttpStatusCode.OK);
        Assert.Equal("opened", (await Stored("ml_3"))["status"]!.GetValue<string>());
        Assert.DoesNotContain(Sms.Sent, s => s.To == "5321112244");
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
        Expect(await Send([Up(new { id = "tp_x", kind = "spam", name = "X", body = "Merhaba", enabled = true }, "templates")]), HttpStatusCode.BadRequest, "Şablon geçersiz");
        Expect(await Send([Up(new { id = "tp_ok", kind = "reminder", name = "Hatırlatma", body = "Merhaba {musteri}", enabled = true }, "templates")]), HttpStatusCode.OK);
    }
}
