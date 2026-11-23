using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

/// <summary>Davetle sahip hesabı açma ve sahibin personeline giriş bilgisi tanımlaması.</summary>
public class AccountTests(TestApp app) : IClassFixture<TestApp>
{
    private static async Task<(HttpStatusCode Code, string Title, JsonObject? Body)> Read(HttpResponseMessage res)
    {
        var text = await res.Content.ReadAsStringAsync();
        var json = text.Length > 0 ? JsonNode.Parse(text) as JsonObject : null;
        return (res.StatusCode, res.IsSuccessStatusCode ? "" : json?["title"]?.GetValue<string>() ?? "", json);
    }

    [Fact]
    public async Task Invite_creates_owner_login_once()
    {
        var c = app.CreateClient();
        var info = (await Read(await c.GetAsync("/api/invite/davet-a-123"))).Body!;
        Assert.Equal(("Salon A", false), (info["tenant"]!["name"]!.GetValue<string>(), info["used"]!.GetValue<bool>()));
        Assert.Null(info["tenant"]!["license"]);

        var bad = await Read(await c.PostAsJsonAsync("/api/invite/davet-a-123", new { name = "Ayşe Kaya", phone = "12", email = "yeni@test.local", password = "gizli-sifre-1" }));
        Assert.Equal((HttpStatusCode.BadRequest, "Geçerli bir cep telefonu girin."), (bad.Code, bad.Title));
        var shortPw = await Read(await c.PostAsJsonAsync("/api/invite/davet-a-123", new { name = "Ayşe Kaya", phone = "05321234567", email = "yeni@test.local", password = "kisa" }));
        Assert.StartsWith("Şifre en az 8", shortPw.Title);
        var taken = await Read(await c.PostAsJsonAsync("/api/invite/davet-a-123", new { name = "Ayşe Kaya", phone = "05321234567", email = "berk@test.local", password = "gizli-sifre-1" }));
        Assert.Equal(HttpStatusCode.Conflict, taken.Code);

        var ok = await Read(await c.PostAsJsonAsync("/api/invite/davet-a-123", new { name = "Ayşe Kaya", phone = "05321234567", email = "Yeni@Test.local", password = "gizli-sifre-1" }));
        Assert.Equal(HttpStatusCode.OK, ok.Code);
        Assert.Equal(("u_a_owner", "Ayşe Kaya"), (ok.Body!["user"]!["id"]!.GetValue<string>(), ok.Body["user"]!["name"]!.GetValue<string>()));
        Assert.False(string.IsNullOrEmpty(ok.Body["token"]!.GetValue<string>()));

        // Yeni e-posta/şifre ile giriş; davet artık kullanılmış
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/login", new { email = "yeni@test.local", password = "gizli-sifre-1" })).StatusCode);
        Assert.True((await Read(await c.GetAsync("/api/invite/davet-a-123"))).Body!["used"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsJsonAsync("/api/invite/davet-a-123", new { name = "X", phone = "05321234567", email = "x@test.local", password = "gizli-sifre-1" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/invite/yok")).StatusCode);
    }

}

/// <summary>Sahibin e-postasını değiştirdiği için kendi veritabanında çalışır.</summary>
public class CredentialTests(TestApp app) : IClassFixture<TestApp>
{
    [Fact]
    public async Task Owner_sets_login_for_own_staff_only()
    {
        var owner = await app.LoginAsync("berk@test.local"); // t_b sahibi
        // Başka salonun kullanıcısı
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync("/api/users/u_a_staff/credentials", new { email = "x@test.local", password = "gizli-sifre-1" })).StatusCode);

        var a = await app.LoginAsync("ayse@test.local");
        Assert.Equal(HttpStatusCode.OK, (await a.PostAsJsonAsync("/api/users/u_a_staff/credentials", new { email = "sena@test.local", password = "gizli-sifre-2" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "sena@test.local", password = "gizli-sifre-2" })).StatusCode);
        // Eski e-posta artık geçmez
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "personel@test.local", password = TestApp.Password })).StatusCode);

        var emails = await a.GetFromJsonAsync<JsonObject>("/api/users/emails");
        Assert.Equal("sena@test.local", emails!["u_a_staff"]!.GetValue<string>());

        var rec = await app.LoginAsync("resepsiyon@test.local");
        Assert.Equal(HttpStatusCode.Forbidden, (await rec.PostAsJsonAsync("/api/users/u_a_staff/credentials", new { email = "y@test.local", password = "gizli-sifre-3" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/users/u_a_rec/credentials", new { email = "berk@test.local", password = "gizli-sifre-3" })).StatusCode);
    }
}

public class DemoApp : TestApp
{
    protected override IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?> { ["Demo:AllowReset"] = "true" };
}

public class DemoResetTests(DemoApp demo, TestApp prod) : IClassFixture<DemoApp>, IClassFixture<TestApp>
{
    private static object Db() => new
    {
        version = 3,
        tenants = new[] { new { id = "t_lara", name = "Studio Lara", slug = "lara", status = "active", license = new { start = Fixture.Today, days = 30 } } },
        users = new object[] { new { id = "u_t_lara_owner", tenantId = "t_lara", name = "Zeynep", role = "owner", branchIds = Array.Empty<string>() }, new { id = "u_platform", tenantId = (string?)null, name = "Comodo", role = "platform", branchIds = Array.Empty<string>() } },
    };

    [Fact]
    public async Task Reset_replaces_all_data_with_demo_accounts()
    {
        var c = demo.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/dev/reset", Db())).StatusCode);
        // Demo e-postası kullanıcı kimliğinden türetilir, şifre demo1234
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/login", new { email = "lara.owner@demo.randevuhazir.com.tr", password = "demo1234" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/login", new { email = "platform@demo.randevuhazir.com.tr", password = "demo1234" })).StatusCode);
        // Eski veri silindi
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsJsonAsync("/api/auth/login", new { email = "ayse@test.local", password = TestApp.Password })).StatusCode);
    }

    [Fact]
    public async Task Reset_is_disabled_by_default() =>
        Assert.Equal(HttpStatusCode.NotFound, (await prod.CreateClient().PostAsJsonAsync("/api/dev/reset", Db())).StatusCode);
}
