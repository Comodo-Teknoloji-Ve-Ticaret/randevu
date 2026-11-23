using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ComodoRandevuHazir.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "credentials",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_credentials", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "records",
                columns: table => new
                {
                    collection = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    data = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_records", x => new { x.collection, x.id });
                });

            migrationBuilder.CreateIndex(
                name: "IX_credentials_email",
                table: "credentials",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_records_tenant_id_collection",
                table: "records",
                columns: new[] { "tenant_id", "collection" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "credentials");

            migrationBuilder.DropTable(
                name: "records");
        }
    }
}
