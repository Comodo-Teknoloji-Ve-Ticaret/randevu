using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Kasa kuralları (ön yüz application/cashService.ts ile aynı).</summary>
public class CashTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Line(string id, int unitPrice, int qty = 1, string kind = "service", object? discount = null) =>
        new { id, kind, refId = "sv_a", name = "Kesim", qty, unitPrice, discount };

    private static object Ticket(string id, string date, object[] lines, object[] payments, string status = "open", string? customerId = "m_a1", object? discount = null, int tip = 0) =>
        new { id, branchId = "b_a", date, customerId, lines, discount, tip, payments, status, createdAt = "2026-11-01T10:00:00Z" };

    private static object Pay(string method, int amount) => new { method, amount };

    private async Task<(HttpStatusCode Code, string Title)> Send(string email, object[]? upserts = null, object[]? deletes = null)
    {
        var c = await app.LoginAsync(email);
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts = upserts ?? [], deletes = deletes ?? [] });
        var body = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    private Task<(HttpStatusCode Code, string Title)> Rec(string collection, object data) => Send("resepsiyon@test.local", [new { collection, data }]);

    private static void Expect((HttpStatusCode Code, string Title) r, HttpStatusCode code, string? title = null)
    {
        Assert.True(r.Code == code, $"{(int)r.Code}: {r.Title}");
        if (title is not null) Assert.StartsWith(title, r.Title);
    }

    [Fact]
    public async Task Partial_payment_is_kept_but_overpayment_is_rejected()
    {
        var d = Fixture.DaysAgo(1);
        Expect(await Rec("tickets", Ticket("k_p1", d, [Line("l1", 50000)], [Pay("cash", 20000)])), HttpStatusCode.OK);
        Expect(await Rec("tickets", Ticket("k_p1", d, [Line("l1", 50000)], [Pay("cash", 60000)])), HttpStatusCode.BadRequest, "Ödeme tutarı adisyon toplamını aşıyor");
    }

    [Fact]
    public async Task Closing_requires_full_payment_and_a_customer_for_debt()
    {
        var d = Fixture.DaysAgo(2);
        Expect(await Rec("tickets", Ticket("k_c1", d, [Line("l1", 50000)], [Pay("cash", 20000)], "closed")), HttpStatusCode.BadRequest, "Adisyonda ödenmemiş tutar var");
        Expect(await Rec("tickets", Ticket("k_c2", d, [Line("l1", 50000)], [Pay("debt", 50000)], "closed", customerId: null)), HttpStatusCode.BadRequest, "Veresiye için adisyona müşteri seçin");
        Expect(await Rec("tickets", Ticket("k_c3", d, [Line("l1", 50000, kind: "package_sale")], [Pay("cash", 50000)], "closed", customerId: null)), HttpStatusCode.BadRequest, "Paket satışı için");
        // %10 indirim + 2.500 ₺ bahşiş: 45.000 + 30.000 → 67.500 + 2.500 = 70.000
        Expect(await Rec("tickets", Ticket("k_c4", d, [Line("l1", 45000), Line("l2", 30000)], [Pay("cash", 40000), Pay("card", 30000)], "closed", discount: new { type = "percent", value = 10 }, tip: 2500)), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Closed_ticket_cannot_be_changed_or_deleted()
    {
        var d = Fixture.DaysAgo(3);
        Expect(await Rec("tickets", Ticket("k_x1", d, [Line("l1", 30000)], [Pay("cash", 30000)], "closed")), HttpStatusCode.OK);
        Expect(await Rec("tickets", Ticket("k_x1", d, [Line("l1", 10000)], [Pay("cash", 10000)], "closed")), HttpStatusCode.Conflict, "Kapalı adisyon değiştirilemez");
        Expect(await Send("ayse@test.local", deletes: [new { collection = "tickets", id = "k_x1" }]), HttpStatusCode.Conflict, "Kapalı adisyon");
        // Açık adisyon silinebilir (vazgeç)
        Expect(await Rec("tickets", Ticket("k_x2", d, [Line("l1", 30000)], [])), HttpStatusCode.OK);
        Expect(await Send("resepsiyon@test.local", deletes: [new { collection = "tickets", id = "k_x2" }]), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Invalid_lines_and_payments_are_rejected()
    {
        var d = Fixture.DaysAgo(4);
        Expect(await Rec("tickets", Ticket("k_i1", d, [Line("l1", -100)], [])), HttpStatusCode.BadRequest, "Adisyon satırı geçersiz");
        Expect(await Rec("tickets", Ticket("k_i2", d, [Line("l1", 100, kind: "hediye")], [])), HttpStatusCode.BadRequest, "Adisyon satırı geçersiz");
        Expect(await Rec("tickets", Ticket("k_i3", d, [Line("l1", 100, discount: new { type = "percent", value = 150 })], [])), HttpStatusCode.BadRequest, "İndirim geçersiz");
        Expect(await Rec("tickets", Ticket("k_i4", d, [Line("l1", 100)], [Pay("bitcoin", 100)])), HttpStatusCode.BadRequest, "Ödeme geçersiz");
    }

    [Fact]
    public async Task Debt_collection_cannot_exceed_open_balance()
    {
        var d = Fixture.DaysAgo(5);
        // m_a1: 7.500 ₺ veresiye
        Expect(await Rec("tickets", Ticket("k_d1", d, [Line("l1", 750000)], [Pay("debt", 750000)], "closed")), HttpStatusCode.OK);
        object Col(string id, int amount) => new { id, branchId = "b_a", customerId = "m_a1", date = d, amount, method = "cash" };
        Expect(await Rec("debtCollections", Col("dc_1", 500000)), HttpStatusCode.OK);
        Expect(await Rec("debtCollections", Col("dc_2", 500000)), HttpStatusCode.BadRequest, "Tahsilat, müşterinin açık borcundan fazla olamaz");
        Expect(await Rec("debtCollections", Col("dc_3", 250000)), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Locked_day_freezes_cash_and_only_owner_reopens()
    {
        var d = Fixture.DaysAgo(6);
        Expect(await Rec("tickets", Ticket("k_l1", d, [Line("l1", 40000)], [Pay("cash", 40000)], "closed")), HttpStatusCode.OK);
        Expect(await Rec("expenses", new { id = "e_l1", branchId = "b_a", date = d, category = "Mutfak", amount = 5000, method = "cash", note = "" }), HttpStatusCode.OK);

        // Ekranın gönderdiği beklenen nakit yanlış olsa bile sunucu kendi hesabını yazar: 400 − 50 = 350 ₺
        Expect(await Rec("dayCloses", new { id = "dz_l", branchId = "b_a", date = d, expectedCash = 0, countedCash = 35000, note = "", closedBy = "u_a_rec", locked = true }), HttpStatusCode.OK);
        var db = await (await app.LoginAsync("ayse@test.local")).GetFromJsonAsync<JsonObject>("/api/sync");
        Assert.Equal(35000, db!["dayCloses"]!.AsArray().First(x => x!["id"]!.GetValue<string>() == "dz_l")!["expectedCash"]!.GetValue<int>());

        Expect(await Rec("tickets", Ticket("k_l2", d, [Line("l1", 10000)], [Pay("cash", 10000)], "closed")), HttpStatusCode.Conflict, "Bu günün kasası kapatılmış");
        Expect(await Rec("expenses", new { id = "e_l2", branchId = "b_a", date = d, category = "Mutfak", amount = 100, method = "cash", note = "" }), HttpStatusCode.Conflict, "Bu günün kasası kapatılmış");
        Expect(await Rec("debtCollections", new { id = "dc_l", branchId = "b_a", customerId = "m_a1", date = d, amount = 100, method = "cash" }), HttpStatusCode.Conflict, "Bu günün kasası kapatılmış");

        object Reopen() => new { id = "dz_l", branchId = "b_a", date = d, expectedCash = 35000, countedCash = 35000, note = "", closedBy = "u_a_rec", locked = false };
        Expect(await Rec("dayCloses", Reopen()), HttpStatusCode.Forbidden, "Kasayı yalnızca salon sahibi açabilir");
        Expect(await Send("ayse@test.local", [new { collection = "dayCloses", data = Reopen() }]), HttpStatusCode.OK);
        Expect(await Rec("expenses", new { id = "e_l3", branchId = "b_a", date = d, category = "Mutfak", amount = 100, method = "cash", note = "" }), HttpStatusCode.OK);
    }
}
