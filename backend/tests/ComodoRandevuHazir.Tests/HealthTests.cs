using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ComodoRandevuHazir.Tests;

public class HealthTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_returns_ok()
    {
        var res = await factory.CreateClient().GetFromJsonAsync<Dictionary<string, string>>("/api/health");
        Assert.Equal("ok", res!["status"]);
    }
}
