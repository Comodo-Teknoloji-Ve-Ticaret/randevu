using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace ComodoRandevuHazir.Tests;

public class PublicBookingTests(TestApp app) : IClassFixture<TestApp>
{
    private static object Booking(int start, string phone = "0535 444 55 66", string staffId = "any") =>
        new { branchId = "b_a", serviceIds = new[] { "sv_a" }, staffId, date = Fixture.Tomorrow, start, name = "Deniz Ak", phone, note = "" };

    private async Task<int[]> Slots() =>
        (await app.CreateClient().GetFromJsonAsync<JsonArray>($"/api/public/salon-a/slots?branchId=b_a&serviceIds=sv_a&staffId=any&date={Fixture.Tomorrow}"))!
            .Select(s => s!["start"]!.GetValue<int>()).ToArray();

    private async Task<JsonObject?> OwnerSees(string collection, Func<JsonObject, bool> match)
    {
        var db = await (await app.LoginAsync("ayse@test.local")).GetFromJsonAsync<JsonObject>("/api/sync");
        return db![collection]!.AsArray().OfType<JsonObject>().FirstOrDefault(match);
    }

    [Fact]
    public async Task Info_shows_bookable_services_without_private_data()
    {
        var res = await app.CreateClient().GetAsync("/api/public/salon-a");
        var body = await res.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var info = JsonNode.Parse(body)!;
        Assert.Equal("Salon A", info["tenant"]!["name"]!.GetValue<string>());
        Assert.Equal(["sv_a"], info["services"]!.AsArray().Select(s => s!["id"]!.GetValue<string>()));
        Assert.DoesNotContain("serviceCommission", body);
        Assert.DoesNotContain("5551112233", body); // personel telefonu
        Assert.DoesNotContain("5321112233", body); // müşteri telefonu
        Assert.DoesNotContain("license", body);
    }

    [Theory]
    [InlineData("yok")]       // bilinmeyen salon
    [InlineData("askida")]    // askıya alınmış
    [InlineData("eski")]      // lisansı kilitli
    [InlineData("salon-b")]   // online randevu ayarı yok
    public async Task Unavailable_salons_are_not_found(string slug) =>
        Assert.Equal(HttpStatusCode.NotFound, (await app.CreateClient().GetAsync($"/api/public/{slug}")).StatusCode);

    [Fact]
    public async Task Books_pending_online_appointment_and_hides_the_slot()
    {
        Assert.Contains(600, await Slots());
        var res = await app.CreateClient().PostAsJsonAsync("/api/public/salon-a/book", Booking(600));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var r = (await res.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("pending", r["status"]!.GetValue<string>());
        Assert.DoesNotContain(600, await Slots());

        var code = r["code"]!.GetValue<string>();
        var appt = await OwnerSees("appointments", a => a["code"]?.GetValue<string>() == code);
        Assert.Equal(("online", "s_a1", 600, 630), (appt!["source"]!.GetValue<string>(), appt["staffId"]!.GetValue<string>(), appt["start"]!.GetValue<int>(), appt["end"]!.GetValue<int>()));
        var customer = await OwnerSees("customers", c => c["id"]!.GetValue<string>() == appt["customerId"]!.GetValue<string>());
        Assert.Equal("5354445566", customer!["phone"]!.GetValue<string>());

        var again = await app.CreateClient().PostAsJsonAsync("/api/public/salon-a/book", Booking(600, "05357778899"));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Existing_customer_is_recognised_by_phone()
    {
        var res = await app.CreateClient().PostAsJsonAsync("/api/public/salon-a/book", Booking(900, "+90 532 111 22 33"));
        var code = (await res.Content.ReadFromJsonAsync<JsonObject>())!["code"]!.GetValue<string>();
        var appt = await OwnerSees("appointments", a => a["code"]?.GetValue<string>() == code);
        Assert.Equal("m_a1", appt!["customerId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Invalid_phone_is_rejected() =>
        Assert.Equal(HttpStatusCode.BadRequest, (await app.CreateClient().PostAsJsonAsync("/api/public/salon-a/book", Booking(660, "12"))).StatusCode);

    [Fact]
    public async Task Simultaneous_requests_for_one_slot_book_only_once()
    {
        var calls = Enumerable.Range(0, 5).Select(i => app.CreateClient().PostAsJsonAsync("/api/public/salon-a/book", Booking(720, $"053600000{i:00}")));
        var results = await Task.WhenAll(calls);
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(4, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
    }
}
