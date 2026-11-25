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

public class PasswordResetEntity
{
    public required string UserId { get; set; }
    public required string CodeHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<RecordEntity> Records => Set<RecordEntity>();
    public DbSet<CredentialEntity> Credentials => Set<CredentialEntity>();
    public DbSet<PasswordResetEntity> PasswordResets => Set<PasswordResetEntity>();

    /// <summary>Paylaşılan veritabanında diğer uygulamaların tablolarıyla karışmasın diye tüm nesnelerin öneki.</summary>
    public const string Prefix = "randevu_";
    public const string RecordSequence = Prefix + "records_seq";
    public const string MigrationsTable = Prefix + "__EFMigrationsHistory";
    /// <summary>Anahtarlar PostgreSQL'deki gibi büyük/küçük harfe duyarlı karşılaştırılır (sunucu varsayılanı duyarsız).</summary>
    public const string KeyCollation = "Latin1_General_100_BIN2";

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasSequence<long>(RecordSequence);
        b.Entity<RecordEntity>(e =>
        {
            e.ToTable(Prefix + "records");
            e.HasKey(x => new { x.Collection, x.Id }).HasName("pk_" + Prefix + "records");
            e.Property(x => x.Collection).HasColumnName("collection").HasMaxLength(40).UseCollation(KeyCollation);
            e.Property(x => x.Id).HasColumnName("id").HasMaxLength(80).UseCollation(KeyCollation);
            e.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(80).UseCollation(KeyCollation);
            e.Property(x => x.Data).HasColumnName("data").HasColumnType("nvarchar(max)");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
            e.Property(x => x.Seq).HasColumnName("seq").HasDefaultValueSql($"NEXT VALUE FOR [{RecordSequence}]");
            e.HasIndex(x => new { x.TenantId, x.Collection, x.Seq }).HasDatabaseName("ix_" + Prefix + "records_tenant_collection");
        });
        b.Entity<CredentialEntity>(e =>
        {
            e.ToTable(Prefix + "credentials");
            e.HasKey(x => x.UserId).HasName("pk_" + Prefix + "credentials");
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(80).UseCollation(KeyCollation);
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(254).UseCollation(KeyCollation);
            e.Property(x => x.PasswordHash).HasColumnName("password_hash");
            e.HasIndex(x => x.Email).IsUnique().HasDatabaseName("ix_" + Prefix + "credentials_email");
        });
        b.Entity<PasswordResetEntity>(e =>
        {
            e.ToTable(Prefix + "password_resets");
            e.HasKey(x => x.UserId).HasName("pk_" + Prefix + "password_resets");
            e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(80).UseCollation(KeyCollation);
            e.Property(x => x.CodeHash).HasColumnName("code_hash");
            e.Property(x => x.ExpiresAt).HasColumnName("expires_at");
            e.Property(x => x.Attempts).HasColumnName("attempts");
        });
    }
}
