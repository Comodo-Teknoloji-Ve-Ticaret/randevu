using Microsoft.EntityFrameworkCore;

namespace ComodoRandevuHazir.Infrastructure.Persistence;

public class RecordEntity
{
    public required string Collection { get; set; }
    public required string Id { get; set; }
    public string? TenantId { get; set; }
    public required string Data { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    /// <summary>Ekleme sırası: ön yüz dizilerin sırasına güvenir (ilk şube varsayılan, personel sırası…).</summary>
    public long Seq { get; set; }
}

public class CredentialEntity
{
    public required string UserId { get; set; }
    public required string Email { get; set; }
    public required string PasswordHash { get; set; }
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<RecordEntity> Records => Set<RecordEntity>();
    public DbSet<CredentialEntity> Credentials => Set<CredentialEntity>();

    public const string RecordSequence = "records_seq";

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasSequence<long>(RecordSequence);
        b.Entity<RecordEntity>(e =>
        {
            e.ToTable("records");
            e.HasKey(x => new { x.Collection, x.Id });
            e.Property(x => x.Collection).HasColumnName("collection").HasMaxLength(40);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(80);
            e.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(80);
            e.Property(x => x.Data).HasColumnName("data").HasColumnType("jsonb");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.Property(x => x.Seq).HasColumnName("seq").HasDefaultValueSql($"nextval('{RecordSequence}')");
            e.HasIndex(x => new { x.TenantId, x.Collection });
        });
        b.Entity<CredentialEntity>(e =>
        {
            e.ToTable("credentials");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(80);
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(254);
            e.Property(x => x.PasswordHash).HasColumnName("password_hash");
            e.HasIndex(x => x.Email).IsUnique();
        });
    }
}
