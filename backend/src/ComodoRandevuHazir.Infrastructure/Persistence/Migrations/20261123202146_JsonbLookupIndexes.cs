using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ComodoRandevuHazir.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class JsonbLookupIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Günlük takvim/müsaitlik sorguları, telefonla müşteri bulma ve online randevu adresi (slug) için.
            migrationBuilder.Sql("CREATE INDEX ix_records_tenant_collection_date ON records (tenant_id, collection, (data ->> 'date'));");
            migrationBuilder.Sql("CREATE INDEX ix_records_tenant_collection_phone ON records (tenant_id, collection, (data ->> 'phone'));");
            migrationBuilder.Sql("CREATE UNIQUE INDEX ix_records_tenant_slug ON records ((data ->> 'slug')) WHERE collection = 'tenants';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_records_tenant_slug;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_records_tenant_collection_phone;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_records_tenant_collection_date;");
        }
    }
}
