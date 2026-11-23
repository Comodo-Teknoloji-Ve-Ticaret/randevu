using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Randevu, blok ve müşteri kayıtlarının sunucu tarafı doğrulaması.</summary>
public class RecordRulesTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Appt(string id, int start = 600, int end = 630, string staffId = "s_a1", string? customerId = "m_a1", string status = "confirmed") =>
        new { id, branchId = "b_a", staffId, customerId, date = Fixture.Tomorrow, start, end, items = Array.Empty<object>(), status, source = "reception" };

    private async Task<(HttpStatusCode, string)> Save(string collection, object data)
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection, data } } });
        var body = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task Valid_appointment_and_reception_override_of_overlap_are_saved()
    {
        Assert.Equal(HttpStatusCode.OK, (await Save("appointments", Appt("a_r1"))).Item1);
        // Ekranda çakışma uyarısı onaylanabiliyor; sunucu resepsiyonun kararını reddetmez.
        Assert.Equal(HttpStatusCode.OK, (await Save("appointments", Appt("a_r2", 615, 645))).Item1);
        Assert.Equal(HttpStatusCode.OK, (await Save("appointments", Appt("a_walkin", customerId: null))).Item1);
    }

    [Theory]
    [InlineData(630, 600, "confirmed", "s_a1", "m_a1", "Randevu saatleri")]
    [InlineData(600, 2000, "confirmed", "s_a1", "m_a1", "Randevu saatleri")]
    [InlineData(600, 630, "bogus", "s_a1", "m_a1", "Geçersiz randevu durumu")]
    [InlineData(600, 630, "confirmed", "s_yok", "m_a1", "Personel bulunamadı")]
    [InlineData(600, 630, "confirmed", "s_a1", "m_b1", "Müşteri bulunamadı")]
    public async Task Invalid_appointments_are_rejected(int start, int end, string status, string staffId, string customerId, string message)
    {
        var (code, title) = await Save("appointments", Appt("a_bad", start, end, staffId, customerId, status));
        Assert.Equal(HttpStatusCode.BadRequest, code);
        Assert.StartsWith(message, title);
    }

    [Fact]
    public async Task Appointment_date_must_be_a_real_day()
    {
        var (code, title) = await Save("appointments", new { id = "a_date", branchId = "b_a", staffId = "s_a1", date = "2026-13-45", start = 600, end = 630, status = "confirmed" });
        Assert.Equal((HttpStatusCode.BadRequest, true), (code, title.StartsWith("Geçersiz tarih")));
    }

    [Fact]
    public async Task Blocks_need_a_valid_range_and_staff()
    {
        Assert.Equal(HttpStatusCode.OK, (await Save("blocks", new { id = "bl_ok", staffId = "s_a1", date = Fixture.Tomorrow, start = 720, end = 780, kind = "break", note = "" })).Item1);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save("blocks", new { id = "bl_bad", staffId = "s_a1", date = Fixture.Tomorrow, start = 780, end = 720, kind = "break" })).Item1);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save("blocks", new { id = "bl_bad2", staffId = "s_b", date = Fixture.Tomorrow, start = 720, end = 780, kind = "break" })).Item1);
    }

    [Fact]
    public async Task Customers_need_a_valid_unique_phone()
    {
        Assert.StartsWith("Telefon numarası geçersiz", (await Save("customers", new { id = "m_p1", name = "X", phone = "123" })).Item2);
        var dup = await Save("customers", new { id = "m_p2", name = "Elif 2", phone = "5321112233" });
        Assert.Equal((HttpStatusCode.Conflict, true), (dup.Item1, dup.Item2.StartsWith("Bu telefonla kayıtlı bir müşteri")));
        // Mevcut müşterinin kendi numarasıyla güncellenmesi serbest
        Assert.Equal(HttpStatusCode.OK, (await Save("customers", new { id = "m_a1", name = "Elif Yeni", phone = "5321112233" })).Item1);
    }
}
