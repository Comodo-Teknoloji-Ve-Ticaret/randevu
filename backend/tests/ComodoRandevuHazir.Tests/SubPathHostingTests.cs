using System.Net;
using System.Net.Http.Json;

namespace ComodoRandevuHazir.Tests;

/// <summary>
/// IIS/Plesk'te API sitenin "/api" alt uygulamasına kurulur: IIS adresin "/api" kısmını PathBase olarak ayırır
/// ve uygulamaya "/auth/login" gibi kısa yol gelir. Ön yüz yine "https://alanadi/api/auth/login" adresini çağırır.
/// </summary>
public class SubPathHostingTests(TestApp app) : IClassFixture<TestApp>
{
    private HttpClient UnderApiApplication()
    {
        var f = app.WithWebHostBuilder(_ => { });
        f.Server.BaseAddress = new Uri("http://localhost/api/"); // TestServer bu yolu PathBase yapar (IIS alt uygulaması gibi)
        return f.Server.CreateClient(); // istemci de aynı /api/ adresini kullanır
    }

    [Fact]
    public async Task Health_works_when_hosted_as_api_sub_application()
    {
        var res = await UnderApiApplication().GetFromJsonAsync<Dictionary<string, string>>("health");
        Assert.Equal("ok", res!["status"]);
    }

    [Fact]
    public async Task Login_works_when_hosted_as_api_sub_application()
    {
        var res = await UnderApiApplication().PostAsJsonAsync("auth/login", new { email = "ayse@test.local", password = TestApp.Password });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Root_hosting_keeps_working()
    {
        var res = await app.CreateClient().GetFromJsonAsync<Dictionary<string, string>>("/api/health");
        Assert.Equal("ok", res!["status"]);
    }
}
