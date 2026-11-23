using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Comodo yönetim paneli: kullanıcı açma, e-posta ve şifre değiştirme.</summary>
public class AdminUserTests(TestApp app) : IClassFixture<TestApp>
{
    private async Task<HttpStatusCode> Login(string email, string password) =>
        (await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password })).StatusCode;

    private static async Task<string> Title(HttpResponseMessage r) => JsonNode.Parse(await r.Content.ReadAsStringAsync())!["title"]!.GetValue<string>();

    [Fact]
    public async Task Platform_admin_changes_a_salon_users_email_only()
    {
        var p = await app.LoginAsync("platform@test.local");
        Assert.Equal(HttpStatusCode.OK, (await p.PostAsJsonAsync("/api/users/u_b_owner/email", new { email = "berk.yeni@test.local" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Login("berk.yeni@test.local", TestApp.Password)); // şifre aynı kaldı
        Assert.Equal(HttpStatusCode.Unauthorized, await Login("berk@test.local", TestApp.Password));

        var taken = await p.PostAsJsonAsync("/api/users/u_b_owner/email", new { email = "ayse@test.local" });
        Assert.Equal((HttpStatusCode.Conflict, "Bu e-posta zaten kullanılıyor."), (taken.StatusCode, await Title(taken)));
        var bad = await p.PostAsJsonAsync("/api/users/u_b_owner/email", new { email = "gecersiz" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Platform_admin_sets_a_new_password_only()
    {
        var p = await app.LoginAsync("platform@test.local");
        Assert.Equal(HttpStatusCode.OK, (await p.PostAsJsonAsync("/api/users/u_old_owner/password", new { password = "yonetici-verdi-1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, await Login("eski@test.local", "yonetici-verdi-1")); // şifre doğru; lisansı dolu olduğu için 403
        Assert.Equal(HttpStatusCode.Unauthorized, await Login("eski@test.local", TestApp.Password));
    }

    [Fact]
    public async Task Email_change_needs_existing_login()
    {
        var p = await app.LoginAsync("platform@test.local");
        Assert.Equal(HttpStatusCode.OK, (await p.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection = "users", data = new { id = "u_a_new", tenantId = "t_a", name = "Yeni", role = "reception", branchIds = new[] { "b_a" } } } } })).StatusCode);
        var r = await p.PostAsJsonAsync("/api/users/u_a_new/email", new { email = "yeni.kisi@test.local" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.StartsWith("Bu kullanıcının giriş bilgisi yok", await Title(r));
    }

    [Fact]
    public async Task Owner_manages_only_own_salon_and_reception_cannot()
    {
        var owner = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync("/api/users/u_a_staff/password", new { password = "personel-yeni-1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync("/api/users/u_b_owner/password", new { password = "x-x-x-x-x-x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync("/api/users/u_platform/email", new { email = "ele@gecir.com" })).StatusCode);
        var rec = await app.LoginAsync("resepsiyon@test.local");
        Assert.Equal(HttpStatusCode.Forbidden, (await rec.PostAsJsonAsync("/api/users/u_a_staff/password", new { password = "personel-yeni-2" })).StatusCode);
    }

    [Fact]
    public async Task Platform_admin_opens_another_comodo_admin()
    {
        var p = await app.LoginAsync("platform@test.local");
        var res = await p.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection = "users", data = new { id = "u_comodo_2", tenantId = (string?)null, name = "Ekip Arkadaşı", role = "platform", branchIds = Array.Empty<string>() } } } });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await p.PostAsJsonAsync("/api/users/u_comodo_2/credentials", new { email = "ekip@comodo.test", password = "ekip-sifre-123" })).StatusCode);
        var login = await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "ekip@comodo.test", password = "ekip-sifre-123" });
        Assert.Equal("platform", (await login.Content.ReadFromJsonAsync<JsonObject>())!["user"]!["role"]!.GetValue<string>());
        // Salon kullanıcısı tenant'sız açılamaz
        var orphan = await p.PostAsJsonAsync("/api/batch", new { upserts = new[] { new { collection = "users", data = new { id = "u_orphan", name = "X", role = "owner", branchIds = Array.Empty<string>() } } } });
        Assert.Equal(HttpStatusCode.BadRequest, orphan.StatusCode);
    }

    [Fact]
    public async Task Admin_cannot_delete_own_account()
    {
        var p = await app.LoginAsync("platform@test.local");
        var r = await p.PostAsJsonAsync("/api/batch", new { deletes = new[] { new { collection = "users", id = "u_platform" } } });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }
}
