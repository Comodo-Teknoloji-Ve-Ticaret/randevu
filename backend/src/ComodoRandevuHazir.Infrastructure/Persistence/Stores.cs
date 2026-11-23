using ComodoRandevuHazir.Application;
using Microsoft.EntityFrameworkCore;

namespace ComodoRandevuHazir.Infrastructure.Persistence;

public partial class RecordStore(AppDbContext db, TimeProvider time) : IRecordStore
{
    public async Task<IReadOnlyList<RecordRow>> ListAsync(string? tenantId, CancellationToken ct) =>
        await db.Records.AsNoTracking()
            .Where(r => tenantId == null || r.TenantId == tenantId)
            .OrderBy(r => r.Seq)
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .ToListAsync(ct);

    public async Task<RecordRow?> GetAsync(string collection, string id, CancellationToken ct) =>
        await db.Records.AsNoTracking()
            .Where(r => r.Collection == collection && r.Id == id)
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .FirstOrDefaultAsync(ct);

    public async Task UpsertManyAsync(IReadOnlyCollection<RecordRow> rows, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var added = new List<RecordEntity>();
        foreach (var group in rows.GroupBy(r => r.Collection))
        {
            var ids = group.Select(r => r.Id).ToList();
            var existing = await db.Records.Where(r => r.Collection == group.Key && ids.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
            foreach (var r in group)
            {
                if (existing.TryGetValue(r.Id, out var e)) { e.TenantId = r.TenantId; e.Data = r.Data; e.UpdatedAt = now; }
                else if (added.FirstOrDefault(a => a.Collection == r.Collection && a.Id == r.Id) is { } dup) { dup.TenantId = r.TenantId; dup.Data = r.Data; }
                else added.Add(new RecordEntity { Collection = r.Collection, Id = r.Id, TenantId = r.TenantId, Data = r.Data, UpdatedAt = now });
            }
        }
        // EF eklemeleri anahtar sırasına göre yazabilir; sıra numaraları gönderim sırasıyla burada atanır.
        if (added.Count > 0)
        {
            var seqs = await db.Database.SqlQuery<long>($"SELECT nextval('records_seq') AS \"Value\" FROM generate_series(1, {added.Count})").ToListAsync(ct);
            seqs.Sort();
            for (var i = 0; i < added.Count; i++) added[i].Seq = seqs[i];
            db.Records.AddRange(added);
        }
        await db.SaveChangesAsync(ct);
    }
}

public partial class RecordStore
{
    public async Task<IReadOnlyList<RecordRow>> GetManyAsync(IReadOnlyCollection<RecordKey> keys, CancellationToken ct)
    {
        var result = new List<RecordRow>();
        foreach (var group in keys.GroupBy(k => k.Collection))
        {
            var ids = group.Select(k => k.Id).Distinct().ToList();
            result.AddRange(await db.Records.AsNoTracking()
                .Where(r => r.Collection == group.Key && ids.Contains(r.Id))
                .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
                .ToListAsync(ct));
        }
        return result;
    }

    public async Task ApplyAsync(IReadOnlyCollection<RecordRow> upserts, IReadOnlyCollection<RecordKey> deletes, CancellationToken ct)
    {
        var own = db.Database.CurrentTransaction is null; // InLockAsync içindeyse onun işlemi kullanılır
        await using var tx = own ? await db.Database.BeginTransactionAsync(ct) : null;
        if (upserts.Count > 0) await UpsertManyAsync(upserts, ct);
        foreach (var group in deletes.GroupBy(k => k.Collection))
        {
            var ids = group.Select(k => k.Id).Distinct().ToList();
            await db.Records.Where(r => r.Collection == group.Key && ids.Contains(r.Id)).ExecuteDeleteAsync(ct);
        }
        if (tx is not null) await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<RecordRow>> ListCollectionAsync(string tenantId, string collection, CancellationToken ct) =>
        await db.Records.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.Collection == collection)
            .OrderBy(r => r.Seq)
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<RecordRow>> ListByFieldAsync(string tenantId, string collection, string field, string value, CancellationToken ct) =>
        await db.Records.FromSqlInterpolated($"SELECT * FROM records WHERE tenant_id = {tenantId} AND collection = {collection} AND data ->> {field} = {value}")
            .AsNoTracking()
            .OrderBy(r => r.Seq)
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .ToListAsync(ct);

    public async Task<RecordRow?> FindTenantBySlugAsync(string slug, CancellationToken ct) =>
        await db.Records.FromSqlInterpolated($"SELECT * FROM records WHERE collection = 'tenants' AND data ->> 'slug' = {slug}")
            .AsNoTracking()
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .FirstOrDefaultAsync(ct);

    public async Task<RecordRow?> FindTenantByInviteAsync(string token, CancellationToken ct) =>
        await db.Records.FromSqlInterpolated($"SELECT * FROM records WHERE collection = 'tenants' AND data -> 'invite' ->> 'token' = {token}")
            .AsNoTracking()
            .Select(r => new RecordRow(r.Collection, r.Id, r.TenantId, r.Data))
            .FirstOrDefaultAsync(ct);

    public async Task ClearAllAsync(CancellationToken ct)
    {
        await db.PasswordResets.ExecuteDeleteAsync(ct);
        await db.Records.ExecuteDeleteAsync(ct);
        await db.Credentials.ExecuteDeleteAsync(ct);
    }

    public async Task<T> InLockAsync<T>(string key, Func<Task<T>> body, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({key}))", ct);
        var result = await body();
        await tx.CommitAsync(ct);
        return result;
    }
}

public class CredentialStore(AppDbContext db) : ICredentialStore
{
    public async Task<Credential?> FindByEmailAsync(string email, CancellationToken ct) =>
        await db.Credentials.AsNoTracking().Where(c => c.Email == email)
            .Select(c => new Credential(c.UserId, c.Email, c.PasswordHash)).FirstOrDefaultAsync(ct);

    public async Task<Credential?> FindByUserAsync(string userId, CancellationToken ct) =>
        await db.Credentials.AsNoTracking().Where(c => c.UserId == userId)
            .Select(c => new Credential(c.UserId, c.Email, c.PasswordHash)).FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyDictionary<string, string>> EmailsAsync(IReadOnlyCollection<string> userIds, CancellationToken ct) =>
        await db.Credentials.AsNoTracking().Where(c => userIds.Contains(c.UserId)).ToDictionaryAsync(c => c.UserId, c => c.Email, ct);

    public async Task SetAsync(Credential c, CancellationToken ct)
    {
        var e = await db.Credentials.FindAsync([c.UserId], ct);
        if (e is null) db.Credentials.Add(new CredentialEntity { UserId = c.UserId, Email = c.Email, PasswordHash = c.PasswordHash });
        else { e.Email = c.Email; e.PasswordHash = c.PasswordHash; }
        await db.SaveChangesAsync(ct);
    }
}

public class PasswordResetStore(AppDbContext db) : IPasswordResetStore
{
    public async Task<PasswordReset?> GetAsync(string userId, CancellationToken ct) =>
        await db.PasswordResets.AsNoTracking().Where(r => r.UserId == userId)
            .Select(r => new PasswordReset(r.UserId, r.CodeHash, r.ExpiresAt, r.Attempts)).FirstOrDefaultAsync(ct);

    public async Task SetAsync(PasswordReset r, CancellationToken ct)
    {
        var e = await db.PasswordResets.FindAsync([r.UserId], ct);
        if (e is null) db.PasswordResets.Add(new PasswordResetEntity { UserId = r.UserId, CodeHash = r.CodeHash, ExpiresAt = r.ExpiresAt, Attempts = r.Attempts });
        else { e.CodeHash = r.CodeHash; e.ExpiresAt = r.ExpiresAt; e.Attempts = r.Attempts; }
        await db.SaveChangesAsync(ct);
    }

    public Task DeleteAsync(string userId, CancellationToken ct) => db.PasswordResets.Where(r => r.UserId == userId).ExecuteDeleteAsync(ct);
}
