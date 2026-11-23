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
}

public interface ICredentialStore
{
    Task<Credential?> FindByEmailAsync(string email, CancellationToken ct);
    Task SetAsync(Credential credential, CancellationToken ct);
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
}

public class ValidationException(string message) : Exception(message);
public class UnauthorizedException(string message) : Exception(message);
public class ForbiddenException(string message) : Exception(message);
public class NotFoundException(string message) : Exception(message);
