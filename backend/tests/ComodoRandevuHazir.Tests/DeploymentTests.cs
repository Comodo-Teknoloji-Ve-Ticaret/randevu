using System.Net;
using System.Net.Http.Json;

namespace ComodoRandevuHazir.Tests;

/// <summary>Gerçek sunucu kurulumu: ilk Comodo yönetici hesabı ve ters vekil (Caddy) arkasında istemci adresi.</summary>
public class AdminBootstrapApp : TestApp
{
    protected override IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?>
    {
        ["Admin:Email"] = "yonetici@comodo.test",
        ["Admin:Password"] = "cok-gizli-sifre-1",
    };
}

public class AdminBootstrapTests(AdminBootstrapApp app) : IClassFixture<AdminBootstrapApp>
{
    [Fact]
    public async Task First_platform_admin_is_created_from_settings()
    {
        var c = app.CreateClient();
        var res = await c.PostAsJsonAsync("/api/auth/login", new { email = "yonetici@comodo.test", password = "cok-gizli-sifre-1" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<System.Text.Json.Nodes.JsonObject>();
        Assert.Equal("platform", body!["user"]!["role"]!.GetValue<string>());
    }
}

public class ProxyApp : TestApp
{
    protected override IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?>
    {
        ["RateLimit:BookPerMinute"] = "1",
        ["Proxy:Trusted"] = "true",
    };
}

public class ProxyTests(ProxyApp app) : IClassFixture<ProxyApp>
{
    private async Task<HttpStatusCode> Book(string clientIp, int start, string phone)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/public/salon-a/book")
        {
            Content = JsonContent.Create(new { branchId = "b_a", serviceIds = new[] { "sv_a" }, staffId = "any", date = Fixture.Tomorrow, start, name = "X", phone }),
        };
        req.Headers.Add("X-Forwarded-For", clientIp);
        return (await app.CreateClient().SendAsync(req)).StatusCode;
    }

    [Fact]
    public async Task Rate_limit_is_per_real_client_behind_the_proxy()
    {
        Assert.Equal(HttpStatusCode.OK, await Book("203.0.113.10", 600, "05360000001"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await Book("203.0.113.10", 660, "05360000002"));
        Assert.Equal(HttpStatusCode.OK, await Book("203.0.113.11", 720, "05360000003")); // başka müşteri etkilenmez
    }
}
