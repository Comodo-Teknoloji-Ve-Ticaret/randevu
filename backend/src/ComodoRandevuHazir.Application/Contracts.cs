namespace ComodoRandevuHazir.Application;

/// <summary>Bir koleksiyon kaydı; Data ön yüzdeki nesnenin camelCase JSON hâlidir.</summary>
public record RecordRow(string Collection, string Id, string? TenantId, string Data);

public record Credential(string UserId, string Email, string PasswordHash);

public record LoginRequest(string Email, string Password);

/// <summary>Token içindeki kimlik: platform yöneticisinde TenantId boştur.</summary>
public record Identity(string UserId, string? TenantId, string Role);

public interface IRecordStore
{
    /// <param name="tenantId">null → tüm kiracılar (platform yöneticisi).</param>
    Task<IReadOnlyList<RecordRow>> ListAsync(string? tenantId, CancellationToken ct);
    Task<RecordRow?> GetAsync(string collection, string id, CancellationToken ct);
    Task UpsertManyAsync(IReadOnlyCollection<RecordRow> rows, CancellationToken ct);
    Task<IReadOnlyList<RecordRow>> GetManyAsync(IReadOnlyCollection<RecordKey> keys, CancellationToken ct);
    /// <summary>Tümü tek işlemde uygulanır; biri başarısızsa hiçbiri yazılmaz.</summary>
    Task ApplyAsync(IReadOnlyCollection<RecordRow> upserts, IReadOnlyCollection<RecordKey> deletes, CancellationToken ct);
    Task<IReadOnlyList<RecordRow>> ListCollectionAsync(string tenantId, string collection, CancellationToken ct);
    /// <summary>Kiracının bir koleksiyonunda üst düzey metin alanı eşleşen kayıtlar (ör. tarih, telefon).</summary>
    Task<IReadOnlyList<RecordRow>> ListByFieldAsync(string tenantId, string collection, string field, string value, CancellationToken ct);
    Task<RecordRow?> FindTenantBySlugAsync(string slug, CancellationToken ct);
    Task<RecordRow?> FindTenantByInviteAsync(string token, CancellationToken ct);
    /// <summary>Tüm kayıtları ve giriş bilgilerini siler (yalnız demo sıfırlama).</summary>
    Task ClearAllAsync(CancellationToken ct);
    /// <summary>Aynı anahtarla gelen işlemleri sıraya sokar (ör. aynı gün için eşzamanlı online randevu).</summary>
    Task<T> InLockAsync<T>(string key, Func<Task<T>> body, CancellationToken ct);
}

public interface ICredentialStore
{
    Task<Credential?> FindByEmailAsync(string email, CancellationToken ct);
    Task SetAsync(Credential credential, CancellationToken ct);
    Task<IReadOnlyDictionary<string, string>> EmailsAsync(IReadOnlyCollection<string> userIds, CancellationToken ct);
    Task<Credential?> FindByUserAsync(string userId, CancellationToken ct);
}

public record PasswordReset(string UserId, string CodeHash, DateTimeOffset ExpiresAt, int Attempts);

public interface IPasswordResetStore
{
    Task<PasswordReset?> GetAsync(string userId, CancellationToken ct);
    Task SetAsync(PasswordReset reset, CancellationToken ct);
    Task DeleteAsync(string userId, CancellationToken ct);
}

public record EmailMessage(string To, string Subject, string Body);

/// <summary>E-posta gönderimi. Smtp:Host ayarlı değilse simülasyon (gönderilmez, günlüğe yazılır).</summary>
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct);
}

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string hash, string password);
}

public interface ITokenIssuer
{
    string Issue(Identity identity);
}

public interface IClock
{
    DateOnly Today { get; }
    DateTimeOffset Now { get; }
    /// <summary>İstanbul saatiyle gün içi dakika.</summary>
    int NowMinutes { get; }
}

public class ValidationException(string message) : Exception(message);
public class UnauthorizedException(string message) : Exception(message);
public class ForbiddenException(string message) : Exception(message);
public class NotFoundException(string message) : Exception(message);
public class ConflictException(string message) : Exception(message);

public record BatchUpsert(string Collection, System.Text.Json.Nodes.JsonObject Data);
public record BatchDelete(string Collection, string Id);
public record BatchRequest(List<BatchUpsert>? Upserts, List<BatchDelete>? Deletes);
public record RecordKey(string Collection, string Id);
