using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Stok miktarı yalnız stok hareketiyle değişir; paket seansı yalnız adisyonla düşer/satılır.</summary>
public class StockPackageTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Up(string collection, object data) => new { collection, data };

    private async Task<(HttpStatusCode Code, string Title)> Send(params object[] upserts) => await SendAs("resepsiyon@test.local", upserts, []);

    private async Task<(HttpStatusCode Code, string Title)> SendAs(string email, object[] upserts, object[] deletes)
    {
        var c = await app.LoginAsync(email);
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts, deletes });
        var body = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    private static void Expect((HttpStatusCode Code, string Title) r, HttpStatusCode code, string? title = null)
    {
        Assert.True(r.Code == code, $"{(int)r.Code}: {r.Title}");
        if (title is not null) Assert.StartsWith(title, r.Title);
    }

    private static object Product(string id, int stock, int vatRate = 20) =>
        new { id, name = "Ürün " + id, brand = "Marka", category = "Genel", kind = "retail", price = 10000, cost = 5000, vatRate, stock, critical = 2 };

    private static object Move(string id, string productId, int qty, string kind, string? ticketId = null) =>
        new { id, productId, date = Fixture.Today, qty, kind, ticketId, note = "" };

    private static object Line(string id, string kind, string refId, int qty = 1, int unitPrice = 0, string? serviceId = null) =>
        new { id, kind, refId, name = "x", qty, unitPrice, discount = (object?)null, serviceId };

    private static object Closed(string id, object[] lines, int paid, string? customerId = "m_a1") =>
        new { id, branchId = "b_a", date = Fixture.Today, customerId, lines, discount = (object?)null, tip = 0,
              payments = paid > 0 ? new object[] { new { method = "cash", amount = paid } } : [], status = "closed", createdAt = "2026-11-01T10:00:00Z" };

    [Fact]
    public async Task Stock_changes_only_with_matching_moves()
    {
        Expect(await Send(Up("products", Product("p_s1", 0))), HttpStatusCode.OK);
        Expect(await Send(Up("products", Product("p_s1", 3)), Up("stockMoves", Move("sm_s1", "p_s1", 3, "in"))), HttpStatusCode.OK);
        Expect(await Send(Up("products", Product("p_s1", 20))), HttpStatusCode.BadRequest, "Stok miktarı stok hareketleriyle uyuşmuyor");
        Expect(await Send(Up("products", Product("p_s1", 1)), Up("stockMoves", Move("sm_s2", "p_s1", -1, "use"))), HttpStatusCode.BadRequest, "Stok miktarı stok hareketleriyle uyuşmuyor");
        // Sayım düzeltmesi
        Expect(await Send(Up("products", Product("p_s1", 1)), Up("stockMoves", Move("sm_s3", "p_s1", -2, "adjust"))), HttpStatusCode.OK);
    }

    [Fact]
    public async Task New_product_starts_from_its_opening_moves()
    {
        Expect(await Send(Up("products", Product("p_n1", 5))), HttpStatusCode.BadRequest, "Stok miktarı stok hareketleriyle uyuşmuyor");
        // Excel içe aktarma: ürün + açılış girişi aynı anda
        Expect(await Send(Up("products", Product("p_n2", 4)), Up("stockMoves", Move("sm_n2", "p_n2", 4, "in"))), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Moves_are_an_append_only_log()
    {
        Expect(await Send(Up("products", Product("p_m1", 2)), Up("stockMoves", Move("sm_m1", "p_m1", 2, "in"))), HttpStatusCode.OK);
        Expect(await Send(Up("stockMoves", Move("sm_m1", "p_m1", 50, "in"))), HttpStatusCode.Conflict, "Stok hareketleri değiştirilemez");
        Expect(await SendAs("ayse@test.local", [], [new { collection = "stockMoves", id = "sm_m1" }]), HttpStatusCode.Conflict, "Stok hareketleri");
        Expect(await Send(Up("products", Product("p_m1", 0)), Up("stockMoves", Move("sm_m2", "p_m1", 2, "use"))), HttpStatusCode.BadRequest, "Stok hareketi geçersiz");
        Expect(await Send(Up("stockMoves", Move("sm_m3", "p_yok", 1, "in"))), HttpStatusCode.BadRequest, "Ürün bulunamadı");
    }

    [Fact]
    public async Task Product_fields_are_validated() =>
        Expect(await Send(Up("products", Product("p_v1", 0, vatRate: 150))), HttpStatusCode.BadRequest, "Ürün bilgileri geçersiz");

    [Fact]
    public async Task Selling_a_product_on_a_ticket_moves_stock()
    {
        Expect(await Send(Up("products", Product("p_t1", 3)), Up("stockMoves", Move("sm_t0", "p_t1", 3, "in"))), HttpStatusCode.OK);
        Expect(await Send(
            Up("products", Product("p_t1", 1)),
            Up("stockMoves", Move("sm_t1", "p_t1", -2, "sale", "k_t1")),
            Up("tickets", Closed("k_t1", [Line("l1", "product", "p_t1", 2, 10000)], 20000))), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Package_definitions_reference_real_services()
    {
        Expect(await Send(Up("packageDefs", new { id = "pd_bad", name = "X", items = new[] { new { serviceId = "sv_yok", count = 3 } }, price = 1000, validDays = 30, active = true })), HttpStatusCode.BadRequest, "Hizmet bulunamadı");
        Expect(await Send(Up("packageDefs", new { id = "pd_bad2", name = "X", items = new[] { new { serviceId = "sv_a", count = 0 } }, price = 1000, validDays = 30, active = true })), HttpStatusCode.BadRequest, "Paket bilgileri geçersiz");
    }

    [Fact]
    public async Task Packages_are_sold_only_through_a_ticket()
    {
        object Cp(string id, string? ticketId) => new { id, customerId = "m_a1", packageDefId = "pd_a", remaining = new Dictionary<string, int> { ["sv_a"] = 4 }, soldOn = Fixture.Today, expiresOn = Fixture.InDays(90), ticketId };
        Expect(await Send(Up("customerPackages", Cp("cp_free", null))), HttpStatusCode.BadRequest, "Paket yalnız adisyonla satılabilir");
        Expect(await Send(
            Up("tickets", Closed("k_ps", [Line("l1", "package_sale", "pd_a", 1, 150000)], 150000)),
            Up("customerPackages", Cp("cp_sold", "k_ps"))), HttpStatusCode.OK);
    }

    [Fact]
    public async Task Package_sessions_drop_only_through_a_closed_ticket()
    {
        object Cp(string id, int left, string expiresOn) => new { id, customerId = "m_a1", packageDefId = "pd_a", remaining = new Dictionary<string, int> { ["sv_a"] = left }, soldOn = Fixture.DaysAgo(10), expiresOn };
        Expect(await Send(Up("customerPackages", Cp("cp_a1", 1, Fixture.InDays(80)))), HttpStatusCode.BadRequest, "Paket seansı yalnız adisyonla düşülebilir");
        Expect(await Send(
            Up("tickets", Closed("k_pu", [Line("l1", "package_use", "cp_a1", serviceId: "sv_a")], 0)),
            Up("customerPackages", Cp("cp_a1", 1, Fixture.InDays(80)))), HttpStatusCode.OK);
        Expect(await Send(
            Up("tickets", Closed("k_pu2", [Line("l1", "package_use", "cp_a2", 2, serviceId: "sv_a")], 0)),
            Up("customerPackages", Cp("cp_a2", -1, Fixture.InDays(80)))), HttpStatusCode.BadRequest, "Pakette bu hizmet için kalan seans yok");
        Expect(await Send(
            Up("tickets", Closed("k_pu3", [Line("l1", "package_use", "cp_old", serviceId: "sv_a")], 0)),
            Up("customerPackages", Cp("cp_old", 2, Fixture.DaysAgo(10)))), HttpStatusCode.BadRequest, "Paketin süresi dolmuş");
    }
}
