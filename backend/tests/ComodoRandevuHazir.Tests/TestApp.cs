using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Application;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;

namespace ComodoRandevuHazir.Tests;

/// <summary>
/// Her test sınıfı için gerçek SQL Server'da ayrı, geçici bir veritabanı açan uygulama.
/// Sunucu: TEST_DB ortam değişkeni ya da yerel docker'daki SQL Server (bkz. README).
/// </summary>
public class TestApp : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string ServerConn = Environment.GetEnvironmentVariable("TEST_DB")
        ?? "Server=localhost,14333;User Id=sa;Password=Yerel_Gelistirme_123;TrustServerCertificate=True;Database=master";

    public const string Password = "demo1234";
    private readonly string _dbName = "rh_test_" + Guid.NewGuid().ToString("N")[..12];

    public string ConnectionString => new SqlConnectionStringBuilder(ServerConn) { InitialCatalog = _dbName }.ConnectionString;

    /// <summary>Alt sınıflar ek ayar verebilir (ör. düşük istek sınırı).</summary>
    protected virtual IDictionary<string, string?> ExtraSettings => new Dictionary<string, string?>();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Db"] = ConnectionString,
            ["Jwt:Key"] = "test-anahtari-test-anahtari-test-anahtari-0123456789",
            ["RateLimit:AuthPerMinute"] = "10000", // testler aynı istemciden çok giriş yapar
        };
        foreach (var (k, v) in ExtraSettings) settings[k] = v;
        builder.ConfigureAppConfiguration(c => c.AddInMemoryCollection(settings));
    }

    public async Task InitializeAsync()
    {
        await using var scope = Services.CreateAsyncScope(); // uygulamayı başlatır → migration uygulanır
        await scope.ServiceProvider.GetRequiredService<ImportService>().ImportAsync(Fixture.Db(), Fixture.Credentials(), default);
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        SqlConnection.ClearAllPools();
        await using var conn = new SqlConnection(ServerConn);
        await conn.OpenAsync();
        await using var cmd = new SqlCommand($"IF DB_ID('{_dbName}') IS NOT NULL BEGIN ALTER DATABASE [{_dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_dbName}]; END", conn);
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
    /// <summary>Her gün 09:00–18:00.</summary>
    public const string Hours = """{"0":{"open":540,"close":1080},"1":{"open":540,"close":1080},"2":{"open":540,"close":1080},"3":{"open":540,"close":1080},"4":{"open":540,"close":1080},"5":{"open":540,"close":1080},"6":{"open":540,"close":1080}}""";
    public static string Tomorrow => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3)).AddDays(1).ToString("yyyy-MM-dd");
    public static string InDays(int n) => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3)).AddDays(n).ToString("yyyy-MM-dd");
    public static string DaysAgo(int n) => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3)).AddDays(-n).ToString("yyyy-MM-dd");

    public static JsonObject Db() => JsonNode.Parse($$"""
    {
      "version": 3,
      "tenants": [
        { "id": "t_a", "name": "Salon A", "slug": "salon-a", "status": "active", "license": { "start": "{{Today}}", "days": 30 }, "brands": [], "plan": "pro", "logoColor": "#6c5ce7",
          "onlineBooking": { "enabled": true, "requireApproval": true, "maxDaysAhead": 30, "minLeadMinutes": 60 },
          "invite": { "token": "davet-a-123", "createdAt": "{{Today}}" } },
        { "id": "t_b", "name": "Salon B", "slug": "salon-b", "status": "active", "license": { "start": "{{Today}}", "days": 30 } },
        { "id": "t_old", "name": "Eski Salon", "slug": "eski", "status": "active", "license": { "start": "{{DaysAgo(40)}}", "days": 30 } },
        { "id": "t_off", "name": "Askıda", "slug": "askida", "status": "suspended", "license": { "start": "{{Today}}", "days": 30 } }
      ],
      "branches": [
        { "id": "b_a", "tenantId": "t_a", "name": "A Merkez", "address": "Lara", "phone": "2420000000", "hours": {{Hours}} },
        { "id": "b_b", "tenantId": "t_b", "name": "B Merkez" }
      ],
      "users": [
        { "id": "u_platform", "tenantId": null, "name": "Comodo", "role": "platform", "branchIds": [] },
        { "id": "u_a_owner", "tenantId": "t_a", "name": "Ayşe", "role": "owner", "branchIds": ["b_a"] },
        { "id": "u_b_owner", "tenantId": "t_b", "name": "Berk", "role": "owner", "branchIds": ["b_b"] },
        { "id": "u_old_owner", "tenantId": "t_old", "name": "Eski", "role": "owner", "branchIds": [] },
        { "id": "u_off_owner", "tenantId": "t_off", "name": "Askı", "role": "owner", "branchIds": [] },
        { "id": "u_a_rec", "tenantId": "t_a", "name": "Resepsiyon", "role": "reception", "branchIds": ["b_a"] },
        { "id": "u_a_staff", "tenantId": "t_a", "name": "Personel", "role": "staff", "staffId": "s_a1", "branchIds": ["b_a"] }
      ],
      "staff": [
        { "id": "s_a1", "tenantId": "t_a", "branchId": "b_a", "name": "Sena", "title": "Kuaför", "color": "#e17055", "phone": "5551112233", "active": true, "hours": {{Hours}}, "serviceIds": ["sv_a"], "serviceCommission": 30 },
        { "id": "s_a2", "tenantId": "t_a", "branchId": "b_a", "name": "Deniz", "active": true, "hours": {{Hours}}, "serviceIds": [], "serviceCommission": 30 }
      ],
      "categories": [ { "id": "c_a", "tenantId": "t_a", "name": "Kesim", "color": "kesim", "order": 0 } ],
      "services": [ { "id": "sv_a", "tenantId": "t_a", "categoryId": "c_a", "name": "Kesim", "duration": 30, "price": 50000, "online": true, "overrides": {} } ],
      "products": [ { "id": "p_a1", "tenantId": "t_a", "name": "Şampuan", "brand": "Loreal", "category": "Şampuan", "kind": "retail", "price": 50000, "cost": 30000, "vatRate": 20, "stock": 5, "critical": 2 } ],
      "packageDefs": [ { "id": "pd_a", "tenantId": "t_a", "name": "5+1 Fön", "items": [ { "serviceId": "sv_a", "count": 3, "bonus": 1 } ], "price": 150000, "validDays": 90, "active": true } ],
      "customerPackages": [
        { "id": "cp_a1", "tenantId": "t_a", "customerId": "m_a1", "packageDefId": "pd_a", "remaining": { "sv_a": 2 }, "soldOn": "{{DaysAgo(10)}}", "expiresOn": "{{InDays(80)}}" },
        { "id": "cp_a2", "tenantId": "t_a", "customerId": "m_a1", "packageDefId": "pd_a", "remaining": { "sv_a": 1 }, "soldOn": "{{DaysAgo(10)}}", "expiresOn": "{{InDays(80)}}" },
        { "id": "cp_old", "tenantId": "t_a", "customerId": "m_a1", "packageDefId": "pd_a", "remaining": { "sv_a": 3 }, "soldOn": "{{DaysAgo(100)}}", "expiresOn": "{{DaysAgo(10)}}" }
      ],
      "customers": [
        { "id": "m_a1", "tenantId": "t_a", "name": "Elif", "phone": "5321112233", "consentSms": true },
        { "id": "m_a2", "tenantId": "t_a", "name": "İzinsiz", "phone": "5321112244", "consentSms": false },
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
        ["u_a_rec"] = ("resepsiyon@test.local", TestApp.Password),
        ["u_a_staff"] = ("personel@test.local", TestApp.Password),
    };
}
