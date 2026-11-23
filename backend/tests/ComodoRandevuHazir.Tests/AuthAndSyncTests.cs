using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ComodoRandevuHazir.Tests;

public class AuthAndSyncTests(TestApp app) : IClassFixture<TestApp>
{
    private static async Task<string?> ProblemTitle(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString();

    [Fact]
    public async Task Login_returns_token_and_user_without_password_hash()
    {
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "AYSE@test.local ", password = TestApp.Password });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        var json = JsonDocument.Parse(body).RootElement;
        Assert.False(string.IsNullOrEmpty(json.GetProperty("token").GetString()));
        Assert.Equal("u_a_owner", json.GetProperty("user").GetProperty("id").GetString());
        Assert.DoesNotContain("AQAAAA", body); // PBKDF2 özeti asla dönmez
    }

    [Theory]
    [InlineData("ayse@test.local", "yanlis")]
    [InlineData("yok@test.local", "demo1234")]
    public async Task Wrong_credentials_are_401_with_same_message(string email, string password)
    {
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("E-posta veya şifre hatalı.", await ProblemTitle(res));
    }

    [Theory]
    [InlineData("eski@test.local", "Lisans süreniz doldu")]
    [InlineData("aski@test.local", "İşletme hesabı askıya alınmış")]
    public async Task Locked_or_suspended_tenant_cannot_log_in(string email, string message)
    {
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password = TestApp.Password });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.StartsWith(message, await ProblemTitle(res));
    }

    [Fact]
    public async Task Sync_requires_token() =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().GetAsync("/api/sync")).StatusCode);

    [Fact]
    public async Task Sync_returns_only_own_tenant_in_frontend_db_shape()
    {
        var client = await app.LoginAsync("ayse@test.local");
        var db = await client.GetFromJsonAsync<JsonElement>("/api/sync");
        Assert.Equal(3, db.GetProperty("version").GetInt32());
        Assert.Equal(["t_a"], db.GetProperty("tenants").EnumerateArray().Select(t => t.GetProperty("id").GetString()));
        Assert.Equal(["m_a1"], db.GetProperty("customers").EnumerateArray().Select(t => t.GetProperty("id").GetString()));
        Assert.Equal(["u_a_owner"], db.GetProperty("users").EnumerateArray().Select(t => t.GetProperty("id").GetString()));
        Assert.Equal(0, db.GetProperty("appointments").GetArrayLength()); // boş koleksiyonlar da gelir
        Assert.Equal("Elif", db.GetProperty("customers")[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Platform_admin_syncs_every_tenant()
    {
        var client = await app.LoginAsync("platform@test.local");
        var db = await client.GetFromJsonAsync<JsonElement>("/api/sync");
        Assert.Equal(4, db.GetProperty("tenants").GetArrayLength());
        Assert.Equal(2, db.GetProperty("customers").GetArrayLength());
    }
}
