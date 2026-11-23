using System.Security.Claims;
using System.Text;
using ComodoRandevuHazir.Application;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ComodoRandevuHazir.Infrastructure.Security;

/// <summary>ASP.NET Identity'nin PBKDF2 tabanlı şifre özeti.</summary>
public class PasswordHasher : IPasswordHasher
{
    private static readonly PasswordHasher<object> Inner = new();
    private static readonly object User = new();

    public string Hash(string password) => Inner.HashPassword(User, password);

    public bool Verify(string hash, string password) =>
        Inner.VerifyHashedPassword(User, hash, password) != PasswordVerificationResult.Failed;
}

public class JwtOptions
{
    public const string Issuer = "randevuhazir";
    public string Key { get; set; } = "";
    public int Hours { get; set; } = 8;

    public SymmetricSecurityKey SigningKey()
    {
        if (Encoding.UTF8.GetByteCount(Key) < 32) throw new InvalidOperationException("Jwt:Key en az 32 karakter olmalı (ortam değişkeni Jwt__Key).");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key));
    }
}

public static class Claim
{
    public const string Tenant = "tenant";
    public const string Role = "role";
}

public class JwtTokenIssuer(JwtOptions options, TimeProvider time) : ITokenIssuer
{
    public string Issue(Identity who)
    {
        var claims = new Dictionary<string, object> { [JwtRegisteredClaimNames.Sub] = who.UserId, [Claim.Role] = who.Role };
        if (who.TenantId is not null) claims[Claim.Tenant] = who.TenantId;
        var now = time.GetUtcNow().UtcDateTime;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = JwtOptions.Issuer,
            Audience = JwtOptions.Issuer,
            Claims = claims,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.AddHours(options.Hours),
            SigningCredentials = new SigningCredentials(options.SigningKey(), SecurityAlgorithms.HmacSha256),
        });
    }

    public static Identity? Read(ClaimsPrincipal p)
    {
        var sub = p.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? p.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var role = p.FindFirst(Claim.Role)?.Value;
        return sub is null || role is null ? null : new Identity(sub, p.FindFirst(Claim.Tenant)?.Value, role);
    }
}

/// <summary>İstanbul 2016'dan beri sabit UTC+3 (yaz saati yok).</summary>
public class IstanbulClock(TimeProvider time) : IClock
{
    private DateTime Now => time.GetUtcNow().UtcDateTime.AddHours(3);
    public DateOnly Today => DateOnly.FromDateTime(Now);
    public int NowMinutes => Now.Hour * 60 + Now.Minute;
}
