using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure.Messaging;
using Microsoft.Extensions.DependencyInjection;

namespace ComodoRandevuHazir.Tests;

/// <summary>Kullanıcının kendi şifresini değiştirmesi ve e-postayla kodla sıfırlama.</summary>
public class PasswordTests(TestApp app) : IClassFixture<TestApp>
{
    private SimulatedEmailSender Mail => (SimulatedEmailSender)app.Services.GetRequiredService<IEmailSender>();

    private async Task<HttpStatusCode> Login(string email, string password) =>
        (await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password })).StatusCode;

    private static async Task<string> Title(HttpResponseMessage res) => JsonNode.Parse(await res.Content.ReadAsStringAsync())!["title"]!.GetValue<string>();

    [Fact]
    public async Task User_changes_own_password_with_current_one()
    {
        var c = await app.LoginAsync("resepsiyon@test.local");
        var wrong = await c.PostAsJsonAsync("/api/me/password", new { currentPassword = "yanlis", newPassword = "yeni-sifre-123" });
        Assert.Equal((HttpStatusCode.BadRequest, "Mevcut şifre hatalı."), (wrong.StatusCode, await Title(wrong)));
        var shortPw = await c.PostAsJsonAsync("/api/me/password", new { currentPassword = TestApp.Password, newPassword = "kisa" });
        Assert.StartsWith("Şifre en az 8", await Title(shortPw));

        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/me/password", new { currentPassword = TestApp.Password, newPassword = "yeni-sifre-123" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await Login("resepsiyon@test.local", TestApp.Password));
        Assert.Equal(HttpStatusCode.OK, await Login("resepsiyon@test.local", "yeni-sifre-123"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().PostAsJsonAsync("/api/me/password", new { currentPassword = "x", newPassword = "yeni-sifre-123" })).StatusCode);
    }

    [Fact]
    public async Task Forgotten_password_is_reset_with_emailed_code()
    {
        var c = app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/forgot", new { email = "Berk@test.local" })).StatusCode);
        var mail = Mail.Sent.Last(m => m.To == "berk@test.local");
        Assert.Contains("şifre", mail.Subject, StringComparison.OrdinalIgnoreCase);
        var code = Regex.Match(mail.Body, @"\b\d{6}\b").Value;
        Assert.Equal(6, code.Length);

        var bad = await c.PostAsJsonAsync("/api/auth/reset", new { email = "berk@test.local", code = code == "000000" ? "111111" : "000000", newPassword = "unutulan-1234" });
        Assert.Equal((HttpStatusCode.BadRequest, "Kod geçersiz ya da süresi dolmuş."), (bad.StatusCode, await Title(bad)));
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/auth/reset", new { email = "berk@test.local", code, newPassword = "unutulan-1234" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Login("berk@test.local", "unutulan-1234"));
        // Kod tek kullanımlık
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/reset", new { email = "berk@test.local", code, newPassword = "baska-sifre-99" })).StatusCode);
    }

    [Fact]
    public async Task Unknown_email_gets_same_answer_and_no_mail()
    {
        var before = Mail.Sent.Count;
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/forgot", new { email = "kimse@test.local" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(before, Mail.Sent.Count);
    }

    [Fact]
    public async Task Code_is_locked_after_five_wrong_tries()
    {
        var c = app.CreateClient();
        await c.PostAsJsonAsync("/api/auth/forgot", new { email = "eski@test.local" });
        var code = Regex.Match(Mail.Sent.Last(m => m.To == "eski@test.local").Body, @"\b\d{6}\b").Value;
        var wrong = code == "999999" ? "888888" : "999999";
        for (var i = 0; i < 5; i++) await c.PostAsJsonAsync("/api/auth/reset", new { email = "eski@test.local", code = wrong, newPassword = "deneme-12345" });
        // Doğru kod bile artık geçmez
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/auth/reset", new { email = "eski@test.local", code, newPassword = "deneme-12345" })).StatusCode);
    }
}

public class AuthLimitApp : TestApp
{
    protected override IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?> { ["RateLimit:AuthPerMinute"] = "3" };
}

public class AuthLimitTests(AuthLimitApp app) : IClassFixture<AuthLimitApp>
{
    [Fact]
    public async Task Login_attempts_are_rate_limited_per_client()
    {
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 4; i++)
            codes.Add((await app.CreateClient().PostAsJsonAsync("/api/auth/login", new { email = "ayse@test.local", password = "tahmin-" + i })).StatusCode);
        Assert.Equal([HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized, HttpStatusCode.TooManyRequests], codes);
    }
}
