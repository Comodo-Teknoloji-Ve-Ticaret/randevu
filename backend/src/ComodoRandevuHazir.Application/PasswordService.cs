using System.Security.Cryptography;

namespace ComodoRandevuHazir.Application;

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Email, string Code, string NewPassword);

/// <summary>
/// Kullanıcının kendi şifresini değiştirmesi ve unutulan şifrenin e-postayla gelen 6 haneli kodla sıfırlanması.
/// Kod 15 dakika geçerli, tek kullanımlık; 5 hatalı denemede iptal olur. Kayıtlı olmayan e-postaya da aynı yanıt verilir.
/// </summary>
public class PasswordService(ICredentialStore credentials, IPasswordResetStore resets, IPasswordHasher hasher, IEmailSender email, IClock clock)
{
    public const int CodeMinutes = 15;
    public const int MaxAttempts = 5;
    private const string BadCode = "Kod geçersiz ya da süresi dolmuş.";

    public async Task ChangeAsync(Identity who, ChangePasswordRequest req, CancellationToken ct)
    {
        var cred = await credentials.FindByUserAsync(who.UserId, ct) ?? throw new ValidationException("Bu hesabın şifresi yok.");
        if (!hasher.Verify(cred.PasswordHash, req.CurrentPassword ?? "")) throw new ValidationException("Mevcut şifre hatalı.");
        ValidPassword(req.NewPassword);
        await credentials.SetAsync(cred with { PasswordHash = hasher.Hash(req.NewPassword) }, ct);
    }

    public async Task ForgotAsync(ForgotPasswordRequest req, CancellationToken ct)
    {
        var cred = await credentials.FindByEmailAsync(AuthService.NormalizeEmail(req.Email ?? ""), ct);
        if (cred is null) return; // e-postanın kayıtlı olup olmadığı dışarı sızmaz
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        await resets.SetAsync(new PasswordReset(cred.UserId, hasher.Hash(code), clock.Now.AddMinutes(CodeMinutes), 0), ct);
        await email.SendAsync(new EmailMessage(cred.Email, "RandevunHazır şifre sıfırlama kodunuz",
            $"Merhaba,\n\nRandevunHazır şifre sıfırlama kodunuz: {code}\n\nKod {CodeMinutes} dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez.\n\nRandevunHazır · Comodo"), ct);
    }

    public async Task ResetAsync(ResetPasswordRequest req, CancellationToken ct)
    {
        ValidPassword(req.NewPassword);
        var cred = await credentials.FindByEmailAsync(AuthService.NormalizeEmail(req.Email ?? ""), ct) ?? throw new ValidationException(BadCode);
        var reset = await resets.GetAsync(cred.UserId, ct);
        if (reset is null || reset.ExpiresAt < clock.Now || reset.Attempts >= MaxAttempts) throw new ValidationException(BadCode);
        if (!hasher.Verify(reset.CodeHash, (req.Code ?? "").Trim()))
        {
            await resets.SetAsync(reset with { Attempts = reset.Attempts + 1 }, ct);
            throw new ValidationException(BadCode);
        }
        await credentials.SetAsync(cred with { PasswordHash = hasher.Hash(req.NewPassword) }, ct);
        await resets.DeleteAsync(cred.UserId, ct);
    }

    public static void ValidPassword(string? p)
    {
        if (p is null || p.Length < 8) throw new ValidationException("Şifre en az 8 karakter olmalı.");
    }
}
