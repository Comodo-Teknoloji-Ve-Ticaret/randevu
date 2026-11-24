using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Salon sahibinin kullanıcıya kutucuklarla verdiği özel yetkiler sunucuda da uygulanır.</summary>
public class CustomPermissionTests(TestApp app) : IClassFixture<TestApp>
{
    private static object User(string id, string role, string[]? perms, string? staffId = null) =>
        new { id, name = id, role, staffId, branchIds = new[] { "b_a" }, perms };

    private static object Ticket(string id) =>
        new { id, branchId = "b_a", date = Fixture.Today, customerId = "m_a1", lines = Array.Empty<object>(), payments = Array.Empty<object>(), status = "open", tip = 0 };

    private async Task<(HttpStatusCode Code, string Title)> Send(HttpClient c, string collection, object data)
    {
        var res = await c.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection, data } } });
        var body = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : JsonNode.Parse(body)!["title"]!.GetValue<string>());
    }

    private async Task<HttpClient> As(string userId, string email)
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync($"/api/users/{userId}/credentials", new { email, password = "yetki-sifre-1" })).StatusCode);
        var c = app.CreateClient();
        var login = await c.PostAsJsonAsync("/api/auth/login", new { email, password = "yetki-sifre-1" });
        c.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<JsonObject>())!["token"]!.GetValue<string>());
        return c;
    }

    [Fact]
    public async Task Reception_without_cash_tick_cannot_use_cash()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, "users", User("u_rec_nocash", "reception", ["calendar", "calendar.all", "customers"]))).Code);
        var c = await As("u_rec_nocash", "nocash@test.local");
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(c, "tickets", Ticket("k_nc"))).Code);
        Assert.Equal(HttpStatusCode.OK, (await Send(c, "customers", new { id = "m_nc", name = "Yeni" })).Code);
    }

    [Fact]
    public async Task Staff_given_cash_tick_can_use_cash()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, "users", User("u_staff_cash", "staff", ["calendar", "customers", "cash", "commission.own"], "s_a2"))).Code);
        var c = await As("u_staff_cash", "staffcash@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(c, "tickets", Ticket("k_sc"))).Code);
    }

    [Fact]
    public async Task Only_owner_manages_users_even_with_settings_tick()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, "users", User("u_rec_settings", "reception", ["calendar", "calendar.all", "settings"]))).Code);
        var c = await As("u_rec_settings", "recset@test.local");
        // Ayarlar yetkisiyle salon bilgisi değişebilir…
        var db = await c.GetFromJsonAsync<JsonObject>("/api/sync");
        var t = db!["tenants"]![0]!.AsObject();
        t["name"] = "Salon A (resepsiyon değiştirdi)";
        Assert.Equal(HttpStatusCode.OK, (await Send(c, "tenants", t)).Code);
        // …ama kullanıcı/yetki yönetimi yalnız sahibin
        var self = await Send(c, "users", User("u_rec_settings", "reception", ["calendar", "calendar.all", "settings", "cash", "reports"]));
        Assert.Equal((HttpStatusCode.Forbidden, true), (self.Code, self.Title.StartsWith("Kullanıcı ve yetkileri yalnız salon sahibi")));
        Assert.Equal(HttpStatusCode.Forbidden, (await c.PostAsJsonAsync("/api/users/u_a_staff/password", new { password = "ele-gecir-123" })).StatusCode);
    }

    [Fact]
    public async Task Unknown_or_platform_permissions_are_rejected()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        var bad = await Send(owner, "users", User("u_bad1", "reception", ["calendar", "platform"]));
        Assert.Equal((HttpStatusCode.BadRequest, true), (bad.Code, bad.Title.StartsWith("Geçersiz yetki")));
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(owner, "users", User("u_bad2", "reception", ["ucmak"]))).Code);
    }

    [Fact]
    public async Task Owner_role_always_has_everything()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, "users", User("u_owner2", "owner", ["calendar"]))).Code);
        var c = await As("u_owner2", "owner2@test.local");
        Assert.Equal(HttpStatusCode.OK, (await Send(c, "tickets", Ticket("k_o2"))).Code); // kısıtlı liste yok sayılır
    }
}
