using ComodoRandevuHazir.Application;
using Microsoft.EntityFrameworkCore;

namespace ComodoRandevuHazir.Infrastructure.Persistence;

public class RecordStore(AppDbContext db, TimeProvider time) : IRecordStore
{
    public async Task<IReadOnlyList<RecordRow>> ListAsync(string? tenantId, CancellationToken ct) =>
        await db.Records.AsNoTracking()
            .Where(r => tenantId == null || r.TenantId == tenantId)
            .OrderBy(r => r.Collection).ThenBy(r => r.Id)
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
        foreach (var group in rows.GroupBy(r => r.Collection))
        {
            var ids = group.Select(r => r.Id).ToList();
            var existing = await db.Records.Where(r => r.Collection == group.Key && ids.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
            foreach (var r in group)
            {
                if (existing.TryGetValue(r.Id, out var e)) { e.TenantId = r.TenantId; e.Data = r.Data; e.UpdatedAt = now; }
                else db.Records.Add(new RecordEntity { Collection = r.Collection, Id = r.Id, TenantId = r.TenantId, Data = r.Data, UpdatedAt = now });
            }
        }
        await db.SaveChangesAsync(ct);
    }
}

public class CredentialStore(AppDbContext db) : ICredentialStore
{
    public async Task<Credential?> FindByEmailAsync(string email, CancellationToken ct) =>
        await db.Credentials.AsNoTracking().Where(c => c.Email == email)
            .Select(c => new Credential(c.UserId, c.Email, c.PasswordHash)).FirstOrDefaultAsync(ct);

    public async Task SetAsync(Credential c, CancellationToken ct)
    {
        var e = await db.Credentials.FindAsync([c.UserId], ct);
        if (e is null) db.Credentials.Add(new CredentialEntity { UserId = c.UserId, Email = c.Email, PasswordHash = c.PasswordHash });
        else { e.Email = c.Email; e.PasswordHash = c.PasswordHash; }
        await db.SaveChangesAsync(ct);
    }
}
