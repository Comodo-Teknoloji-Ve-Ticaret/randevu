using System.Net;
using System.Net.Http.Json;

namespace ComodoRandevuHazir.Tests;

public class LowLimitApp : TestApp
{
    protected override IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?> { ["RateLimit:BookPerMinute"] = "2" };
}

public class RateLimitTests(LowLimitApp app) : IClassFixture<LowLimitApp>
{
    [Fact]
    public async Task Online_booking_is_rate_limited_per_client()
    {
        var c = app.CreateClient();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
            codes.Add((await c.PostAsJsonAsync("/api/public/salon-a/book", new { branchId = "b_a", serviceIds = new[] { "sv_a" }, staffId = "any", date = Fixture.Tomorrow, start = 600 + i * 60, name = "X", phone = $"05360000{i:000}" })).StatusCode);
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests], codes);
    }
}
