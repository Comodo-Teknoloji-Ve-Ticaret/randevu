using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ComodoRandevuHazir.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RecordInsertionOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence(
                name: "records_seq");

            migrationBuilder.AddColumn<long>(
                name: "seq",
                table: "records",
                type: "bigint",
                nullable: false,
                defaultValueSql: "nextval('records_seq')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "seq",
                table: "records");

            migrationBuilder.DropSequence(
                name: "records_seq");
        }
    }
}
