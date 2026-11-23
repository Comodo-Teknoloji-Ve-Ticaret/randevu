using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Application;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace ComodoRandevuHazir.Tests;

/// <summary>
/// Her test sınıfı için gerçek PostgreSQL'de ayrı, geçici bir veritabanı açan uygulama.
/// Sunucu: TEST_DB ortam değişkeni ya da docker compose'daki yerel veritabanı.
/// </summary>
public sealed class TestApp : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string ServerConn = Environment.GetEnvironmentVariable("TEST_DB")
        ?? "Host=localhost;Port=5432;Username=randevuhazir;Password=randevuhazir;Database=postgres";

    public const string Password = "demo1234";
    private readonly string _dbName = "rh_test_" + Guid.NewGuid().ToString("N")[..12];

    public string ConnectionString => new NpgsqlConnectionStringBuilder(ServerConn) { Database = _dbName }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(c => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Db"] = ConnectionString,
            ["Jwt:Key"] = "test-anahtari-test-anahtari-test-anahtari-0123456789",
        }));
    }

    public async Task InitializeAsync()
    {
        await using var scope = Services.CreateAsyncScope(); // uygulamayı başlatır → migration uygulanır
        await scope.ServiceProvider.GetRequiredService<ImportService>().ImportAsync(Fixture.Db(), Fixture.Credentials(), default);
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var conn = new NpgsqlConnection(ServerConn);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_dbName}\" WITH (FORCE)", conn);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<HttpClient> LoginAsync(string email)
    {
        var client = CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        return client;
    }
}

/// <summary>İki salon + platform yöneticisi; ön yüz DB biçiminde küçük veri.</summary>
public static class Fixture
{
    public static string Today => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3)).ToString("yyyy-MM-dd");
    public static string DaysAgo(int n) => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3)).AddDays(-n).ToString("yyyy-MM-dd");

    public static JsonObject Db() => JsonNode.Parse($$"""
    {
      "version": 3,
      "tenants": [
        { "id": "t_a", "name": "Salon A", "slug": "salon-a", "status": "active", "license": { "start": "{{Today}}", "days": 30 } },
        { "id": "t_b", "name": "Salon B", "slug": "salon-b", "status": "active", "license": { "start": "{{Today}}", "days": 30 } },
        { "id": "t_old", "name": "Eski Salon", "slug": "eski", "status": "active", "license": { "start": "{{DaysAgo(40)}}", "days": 30 } },
        { "id": "t_off", "name": "Askıda", "slug": "askida", "status": "suspended", "license": { "start": "{{Today}}", "days": 30 } }
      ],
      "branches": [
        { "id": "b_a", "tenantId": "t_a", "name": "A Merkez" },
        { "id": "b_b", "tenantId": "t_b", "name": "B Merkez" }
      ],
      "users": [
        { "id": "u_platform", "tenantId": null, "name": "Comodo", "role": "platform", "branchIds": [] },
        { "id": "u_a_owner", "tenantId": "t_a", "name": "Ayşe", "role": "owner", "branchIds": ["b_a"] },
        { "id": "u_b_owner", "tenantId": "t_b", "name": "Berk", "role": "owner", "branchIds": ["b_b"] },
        { "id": "u_old_owner", "tenantId": "t_old", "name": "Eski", "role": "owner", "branchIds": [] },
        { "id": "u_off_owner", "tenantId": "t_off", "name": "Askı", "role": "owner", "branchIds": [] }
      ],
      "customers": [
        { "id": "m_a1", "tenantId": "t_a", "name": "Elif", "phone": "5321112233" },
        { "id": "m_b1", "tenantId": "t_b", "name": "Burak", "phone": "5329998877" }
      ]
    }
    """)!.AsObject();

    public static Dictionary<string, (string Email, string Password)> Credentials() => new()
    {
        ["u_platform"] = ("platform@test.local", TestApp.Password),
        ["u_a_owner"] = ("ayse@test.local", TestApp.Password),
        ["u_b_owner"] = ("berk@test.local", TestApp.Password),
        ["u_old_owner"] = ("eski@test.local", TestApp.Password),
        ["u_off_owner"] = ("aski@test.local", TestApp.Password),
    };
}
