using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

public class BatchTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Up(string collection, object data) => new { collection, data };
    private static object Del(string collection, string id) => new { collection, id };

    private static Task<HttpResponseMessage> Batch(HttpClient c, object[]? upserts = null, object[]? deletes = null) =>
        c.PostAsJsonAsync("/api/batch", new { upserts = upserts ?? [], deletes = deletes ?? [] });

    private static async Task<JsonObject?> Find(HttpClient c, string collection, string id)
    {
        var db = await c.GetFromJsonAsync<JsonObject>("/api/sync");
        return db![collection]!.AsArray().OfType<JsonObject>().FirstOrDefault(x => x["id"]!.GetValue<string>() == id);
    }

    private static async Task AssertStatus(HttpStatusCode expected, Task<HttpResponseMessage> call, string? titleStartsWith = null)
    {
        var res = await call;
        var body = await res.Content.ReadAsStringAsync();
        Assert.True(expected == res.StatusCode, $"{(int)res.StatusCode}: {body}");
        if (titleStartsWith is not null) Assert.StartsWith(titleStartsWith, JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task Requires_token() =>
        await AssertStatus(HttpStatusCode.Unauthorized, Batch(app.CreateClient(), [Up("customers", new { id = "m_x" })]));

    [Fact]
    public async Task Owner_creates_customer_scoped_to_own_tenant()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("customers", new { id = "m_new1", name = "Zeynep", phone = "5320000001" })]));
        var saved = await Find(c, "customers", "m_new1");
        Assert.Equal("t_a", saved!["tenantId"]!.GetValue<string>());
        Assert.Null(await Find(await app.LoginAsync("berk@test.local"), "customers", "m_new1"));
    }

    [Fact]
    public async Task Cannot_claim_another_tenant_or_overwrite_its_records()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("customers", new { id = "m_new2", tenantId = "t_b", name = "X" })]), "Bu kayda erişim yetkiniz yok");
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("customers", new { id = "m_b1", name = "Ele geçirildi" })]));
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, deletes: [Del("customers", "m_b1")]));
        Assert.Equal("Burak", (await Find(await app.LoginAsync("berk@test.local"), "customers", "m_b1"))!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task Batch_is_all_or_nothing()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("customers", new { id = "m_atomic", name = "Yarım" }), Up("customers", new { id = "m_b1", name = "X" })]));
        Assert.Null(await Find(c, "customers", "m_atomic"));
    }

    [Fact]
    public async Task Rejects_unknown_collection_and_bad_ids()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("credentials", new { id = "x" })]));
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("customers", new { name = "id yok" })]));
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("customers", new { id = "m_'; drop", name = "X" })]));
    }

    [Fact]
    public async Task Owner_edits_salon_but_never_the_license()
    {
        var c = await app.LoginAsync("ayse@test.local");
        var t = (await Find(c, "tenants", "t_a"))!;
        t["name"] = "Salon A Yeni";
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("tenants", t)]));
        t["license"] = new JsonObject { ["start"] = Fixture.Today, ["days"] = 3650 };
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("tenants", t)]), "Lisans");
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("tenants", new { id = "t_new", name = "Yeni" })]));
    }

    [Fact]
    public async Task Online_booking_address_must_be_unique()
    {
        var c = await app.LoginAsync("ayse@test.local");
        var t = (await Find(c, "tenants", "t_a"))!;
        t["slug"] = "salon-b";
        await AssertStatus(HttpStatusCode.Conflict, Batch(c, [Up("tenants", t)]), "Bu online randevu adresi");
        t["slug"] = "salon-a-yeni";
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("tenants", t)]));
    }

    [Fact]
    public async Task Reception_may_add_brands_but_not_rename_salon()
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var t = (await Find(c, "tenants", "t_a"))!;
        t["brands"] = new JsonArray("Loreal");
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("tenants", t)]));
        t["name"] = "Değişti";
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("tenants", t)]));
    }

    [Fact]
    public async Task Reception_assigns_services_to_staff_but_cannot_touch_commission()
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var s = (await Find(c, "staff", "s_a2"))!;
        s["serviceIds"] = new JsonArray("sv_a");
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("staff", s)]));
        s["serviceCommission"] = 90;
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("staff", s)]));
    }

    [Fact]
    public async Task Staff_books_only_for_themselves_and_has_no_cash_access()
    {
        var c = await app.LoginAsync("personel@test.local");
        object Appt(string id, string staffId) => new { id, branchId = "b_a", staffId, customerId = "m_a1", date = Fixture.Today, start = 600, end = 630, items = Array.Empty<object>(), status = "confirmed" };
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("appointments", Appt("a_own", "s_a1"))]));
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("appointments", Appt("a_other", "s_a2"))]));
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("tickets", new { id = "k_x", branchId = "b_a", lines = Array.Empty<object>() })]));
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, deletes: [Del("services", "sv_a")]));
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("customers", new { id = "m_by_staff", name = "Yeni Müşteri" })]));
    }

    [Fact]
    public async Task Owner_cannot_create_platform_users()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, [Up("users", new { id = "u_evil", name = "X", role = "platform", branchIds = Array.Empty<string>() })]));
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("users", new { id = "u_new_rec", name = "Yeni", role = "reception", branchIds = new[] { "b_a" } })]));
        await AssertStatus(HttpStatusCode.Forbidden, Batch(c, deletes: [Del("users", "u_a_owner")]), "Kendi hesabınızı");
    }

    [Fact]
    public async Task References_must_exist_in_same_tenant()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("services", new { id = "sv_bad", categoryId = "c_yok", name = "X" })]), "Kategori");
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("staff", new { id = "s_bad", branchId = "b_b", name = "X" })]), "Şube");
        // aynı batch'te oluşturulan kategoriye başvurmak serbest
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("categories", new { id = "c_new", name = "Boya" }), Up("services", new { id = "sv_new", categoryId = "c_new", name = "Dip boya" })]));
    }

    [Fact]
    public async Task Owner_deletes_own_record()
    {
        var c = await app.LoginAsync("ayse@test.local");
        await AssertStatus(HttpStatusCode.OK, Batch(c, [Up("customers", new { id = "m_del", name = "Silinecek" })]));
        await AssertStatus(HttpStatusCode.OK, Batch(c, deletes: [Del("customers", "m_del")]));
        Assert.Null(await Find(c, "customers", "m_del"));
    }

    [Fact]
    public async Task Platform_admin_opens_a_new_salon()
    {
        var c = await app.LoginAsync("platform@test.local");
        await AssertStatus(HttpStatusCode.OK, Batch(c, [
            Up("tenants", new { id = "t_yeni", name = "Yeni Salon", status = "active", license = new { start = Fixture.Today, days = 30 } }),
            Up("branches", new { id = "b_yeni", tenantId = "t_yeni", name = "Merkez" }),
        ]));
        await AssertStatus(HttpStatusCode.BadRequest, Batch(c, [Up("branches", new { id = "b_sahipsiz", name = "X" })]), "branches/b_sahipsiz: tenantId");
        Assert.NotNull(await Find(c, "branches", "b_yeni"));
    }
}
