using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

public record InviteAccept(string Name, string Phone, string Email, string Password);
public record CredentialsRequest(string Email, string Password);
public record EmailRequest(string Email);
public record PasswordRequest(string Password);

/// <summary>Demo hesapları: e-posta kullanıcı kimliğinden türetilir (u_t_lara_owner → lara.owner@demo…), şifre ortak.</summary>
public static class DemoAccounts
{
    public const string Password = "demo1234";
    public const string Domain = "demo.randevuhazir.com.tr";

    public static string EmailFor(string userId)
    {
        var s = userId.StartsWith("u_") ? userId[2..] : userId;
        if (s.StartsWith("t_")) s = s[2..];
        return $"{s.Replace('_', '.').ToLowerInvariant()}@{Domain}";
    }
}

/// <summary>Davetle sahip hesabı, sahibin personeline giriş bilgisi tanımlaması ve demo sıfırlama.</summary>
public class AccountService(IRecordStore records, ICredentialStore credentials, IPasswordHasher hasher, ITokenIssuer tokens, IClock clock, ImportService import)
{
    public async Task<JsonObject> InviteInfoAsync(string token, CancellationToken ct)
    {
        var (tenant, _) = await InviteTenantAsync(token, ct);
        var owner = await OwnerAsync(Str(tenant, "id")!, ct);
        return new JsonObject
        {
            ["tenant"] = new JsonObject { ["id"] = Str(tenant, "id"), ["name"] = Str(tenant, "name"), ["logoColor"] = Str(tenant, "logoColor"), ["businessType"] = Str(tenant, "businessType") },
            ["used"] = tenant["invite"]?["usedAt"] is not null,
            ["ownerName"] = owner is null ? null : Str(owner, "name"),
        };
    }

    public async Task<LoginResult> AcceptInviteAsync(string token, InviteAccept req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw new ValidationException("Ad soyad gerekli.");
        if (Phone.Normalize(req.Phone) is null) throw new ValidationException("Geçerli bir cep telefonu girin.");
        var email = ValidEmail(req.Email);
        ValidPassword(req.Password);

        return await records.InLockAsync("invite:" + token, async () =>
        {
            var (tenant, row) = await InviteTenantAsync(token, ct);
            if (tenant["invite"]?["usedAt"] is not null) throw new ConflictException("Bu davet kullanılmış. Giriş ekranından devam edin.");
            if (Str(tenant, "status") == "suspended") throw new ForbiddenException("İşletme hesabı askıya alınmış. Comodo ile iletişime geçin.");
            var owner = await OwnerAsync(row.Id, ct) ?? throw new NotFoundException("Davet linki geçersiz.");
            var ownerId = Str(owner, "id")!;
            await EnsureEmailFreeAsync(email, ownerId, ct);

            owner["name"] = req.Name.Trim();
            tenant["invite"]!["usedAt"] = clock.Today.ToString("yyyy-MM-dd");
            await records.ApplyAsync([new RecordRow("users", ownerId, row.Id, owner.ToJsonString()), new RecordRow("tenants", row.Id, row.Id, tenant.ToJsonString())], [], ct);
            await credentials.SetAsync(new Credential(ownerId, email, hasher.Hash(req.Password)), ct);
            return new LoginResult(tokens.Issue(new Identity(ownerId, row.Id, "owner")), owner);
        }, ct);
    }

    /// <summary>Comodo yöneticisi her kullanıcıyı; salon sahibi yalnız kendi salonunun (platform dışı) kullanıcılarını yönetir.</summary>
    private async Task AuthorizeUserAdminAsync(Identity who, string userId, CancellationToken ct)
    {
        var target = await records.GetAsync("users", userId, ct) ?? throw new NotFoundException("Kullanıcı bulunamadı.");
        var role = Str(JsonNode.Parse(target.Data)!.AsObject(), "role");
        var allowed = who.Role == "platform" || Permissions.Can(who.Role, "settings") && target.TenantId == who.TenantId && role != "platform";
        if (!allowed) throw new ForbiddenException("Bu işlem için yetkiniz yok.");
    }

    private async Task<Credential> ExistingLoginAsync(string userId, CancellationToken ct) =>
        await credentials.FindByUserAsync(userId, ct)
            ?? throw new ValidationException("Bu kullanıcının giriş bilgisi yok; önce e-posta ve şifre belirleyin.");

    public async Task ChangeEmailAsync(Identity who, string userId, EmailRequest req, CancellationToken ct)
    {
        await AuthorizeUserAdminAsync(who, userId, ct);
        var email = ValidEmail(req.Email);
        var cred = await ExistingLoginAsync(userId, ct);
        await EnsureEmailFreeAsync(email, userId, ct);
        await credentials.SetAsync(cred with { Email = email }, ct);
    }

    public async Task ChangePasswordAsync(Identity who, string userId, PasswordRequest req, CancellationToken ct)
    {
        await AuthorizeUserAdminAsync(who, userId, ct);
        ValidPassword(req.Password);
        var cred = await ExistingLoginAsync(userId, ct);
        await credentials.SetAsync(cred with { PasswordHash = hasher.Hash(req.Password) }, ct);
    }

    public async Task SetCredentialsAsync(Identity who, string userId, CredentialsRequest req, CancellationToken ct)
    {
        await AuthorizeUserAdminAsync(who, userId, ct);
        var email = ValidEmail(req.Email);
        ValidPassword(req.Password);
        await EnsureEmailFreeAsync(email, userId, ct);
        await credentials.SetAsync(new Credential(userId, email, hasher.Hash(req.Password)), ct);
    }

    public async Task<IReadOnlyDictionary<string, string>> EmailsAsync(Identity who, CancellationToken ct)
    {
        if (who.Role != "platform" && !Permissions.Can(who.Role, "settings")) throw new ForbiddenException("Bu işlem için yetkiniz yok.");
        var users = who.Role == "platform"
            ? (await records.ListAsync(null, ct)).Where(r => r.Collection == "users")
            : await records.ListCollectionAsync(who.TenantId!, "users", ct);
        return await credentials.EmailsAsync([.. users.Select(u => u.Id)], ct);
    }

    public const string AdminUserId = "u_comodo_admin";

    /// <summary>Gerçek kurulumda ilk Comodo yönetici hesabı (Admin:Email / Admin:Password). Hesap varsa dokunulmaz.</summary>
    public async Task EnsurePlatformAdminAsync(string email, string password, CancellationToken ct)
    {
        var normalized = ValidEmail(email);
        ValidPassword(password);
        if (await credentials.FindByEmailAsync(normalized, ct) is not null) return;
        if (await records.GetAsync("users", AdminUserId, ct) is null)
        {
            var user = new JsonObject { ["id"] = AdminUserId, ["tenantId"] = null, ["name"] = "Comodo Yönetici", ["role"] = "platform", ["branchIds"] = new JsonArray() };
            await records.ApplyAsync([new RecordRow("users", AdminUserId, null, user.ToJsonString())], [], ct);
        }
        await credentials.SetAsync(new Credential(AdminUserId, normalized, hasher.Hash(password)), ct);
    }

    /// <summary>Tüm veriyi siler, verilen demo verisini yükler; her kullanıcıya demo e-postası ve şifresi atanır.</summary>
    public async Task<int> ResetDemoAsync(JsonObject db, CancellationToken ct)
    {
        await records.ClearAllAsync(ct);
        var logins = (db["users"] as JsonArray ?? []).OfType<JsonObject>().Select(u => Str(u, "id")).OfType<string>()
            .ToDictionary(id => id, id => (DemoAccounts.EmailFor(id), DemoAccounts.Password));
        return await import.ImportAsync(db, logins, ct);
    }

    private async Task<(JsonObject Tenant, RecordRow Row)> InviteTenantAsync(string token, CancellationToken ct)
    {
        var row = string.IsNullOrWhiteSpace(token) ? null : await records.FindTenantByInviteAsync(token, ct);
        return row is null ? throw new NotFoundException("Davet linki geçersiz.") : (JsonNode.Parse(row.Data)!.AsObject(), row);
    }

    private async Task<JsonObject?> OwnerAsync(string tenantId, CancellationToken ct) =>
        (await records.ListByFieldAsync(tenantId, "users", "role", "owner", ct)).Select(r => JsonNode.Parse(r.Data)!.AsObject()).FirstOrDefault();

    private async Task EnsureEmailFreeAsync(string email, string userId, CancellationToken ct)
    {
        if (await credentials.FindByEmailAsync(email, ct) is { } c && c.UserId != userId) throw new ConflictException("Bu e-posta zaten kullanılıyor.");
    }

    private static string ValidEmail(string? raw)
    {
        var e = AuthService.NormalizeEmail(raw ?? "");
        var at = e.IndexOf('@');
        if (e.Length > 254 || at < 1 || e.LastIndexOf('.') < at + 2 || e.EndsWith('.') || e.Contains(' ')) throw new ValidationException("Geçerli bir e-posta girin.");
        return e;
    }

    private static void ValidPassword(string? p)
    {
        if (p is null || p.Length < 8) throw new ValidationException("Şifre en az 8 karakter olmalı.");
    }
}
