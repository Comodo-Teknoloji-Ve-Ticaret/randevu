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
            migrationBuilder.CreateSequence(
                name: "randevu_records_seq");

            migrationBuilder.CreateTable(
                name: "randevu_credentials",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false, collation: "Latin1_General_100_BIN2"),
                    email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: false, collation: "Latin1_General_100_BIN2"),
                    password_hash = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_randevu_credentials", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "randevu_password_resets",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false, collation: "Latin1_General_100_BIN2"),
                    code_hash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    attempts = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_randevu_password_resets", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "randevu_records",
                columns: table => new
                {
                    collection = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false, collation: "Latin1_General_100_BIN2"),
                    id = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false, collation: "Latin1_General_100_BIN2"),
                    tenant_id = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true, collation: "Latin1_General_100_BIN2"),
                    data = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    seq = table.Column<long>(type: "bigint", nullable: false, defaultValueSql: "NEXT VALUE FOR [randevu_records_seq]")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_randevu_records", x => new { x.collection, x.id });
                });

            migrationBuilder.CreateIndex(
                name: "ix_randevu_credentials_email",
                table: "randevu_credentials",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_randevu_records_tenant_collection",
                table: "randevu_records",
                columns: new[] { "tenant_id", "collection", "seq" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "randevu_credentials");

            migrationBuilder.DropTable(
                name: "randevu_password_resets");

            migrationBuilder.DropTable(
                name: "randevu_records");

            migrationBuilder.DropSequence(
                name: "randevu_records_seq");
        }
    }
}
