using System.Text.Json;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Application;

public record LoginResult(string Token, JsonNode User);

public class AuthService(IRecordStore records, ICredentialStore credentials, IPasswordHasher hasher, ITokenIssuer tokens, IClock clock)
{
    private const string WrongCredentials = "E-posta veya şifre hatalı.";

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public async Task<LoginResult> LoginAsync(LoginRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrEmpty(req.Password))
            throw new ValidationException("E-posta ve şifre gerekli.");

        var cred = await credentials.FindByEmailAsync(NormalizeEmail(req.Email), ct);
        // Kullanıcı yoksa da aynı mesaj: hangi e-postaların kayıtlı olduğu dışarı sızmaz.
        if (cred is null || !hasher.Verify(cred.PasswordHash, req.Password)) throw new UnauthorizedException(WrongCredentials);

        var userRow = await records.GetAsync("users", cred.UserId, ct) ?? throw new UnauthorizedException(WrongCredentials);
        var user = JsonNode.Parse(userRow.Data)!;
        var role = user["role"]?.GetValue<string>() ?? "staff";
        var tenantId = role == "platform" ? null : userRow.TenantId ?? throw new UnauthorizedException(WrongCredentials);

        if (tenantId is not null) await EnsureTenantCanSignInAsync(tenantId, ct);
        return new LoginResult(tokens.Issue(new Identity(cred.UserId, tenantId, role)), user);
    }

    private async Task EnsureTenantCanSignInAsync(string tenantId, CancellationToken ct)
    {
        var row = await records.GetAsync("tenants", tenantId, ct) ?? throw new ForbiddenException("İşletme bulunamadı.");
        var tenant = JsonDocument.Parse(row.Data).RootElement;
        if (tenant.TryGetProperty("status", out var s) && s.GetString() == "suspended")
            throw new ForbiddenException("İşletme hesabı askıya alınmış. Comodo ile iletişime geçin.");
        if (tenant.TryGetProperty("license", out var l))
        {
            var license = new License(DateOnly.Parse(l.GetProperty("start").GetString()!), l.GetProperty("days").GetInt32());
            if (LicenseRules.Status(license, clock.Today).State == LicenseState.Locked)
                throw new ForbiddenException("Lisans süreniz doldu. Uzatmak için Comodo ile iletişime geçin.");
        }
    }
}
