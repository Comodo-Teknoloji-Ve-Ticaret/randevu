using System.Collections.Concurrent;
using ComodoRandevuHazir.Application;
using Microsoft.Extensions.Logging;

namespace ComodoRandevuHazir.Infrastructure.Messaging;

/// <summary>Gerçek gönderim yapmaz; mesajı günlüğe yazar ve son 500 mesajı bellekte tutar (testler için).</summary>
public class SimulatedSmsSender(ILogger<SimulatedSmsSender> log) : ISmsSender
{
    private readonly ConcurrentQueue<OutgoingSms> _sent = new();

    public string LogStatus => "simulated";

    public IReadOnlyCollection<OutgoingSms> Sent => _sent;

    public Task<SmsResult> SendAsync(OutgoingSms sms, CancellationToken ct)
    {
        _sent.Enqueue(sms);
        while (_sent.Count > 500) _sent.TryDequeue(out _);
        log.LogInformation("SMS (simülasyon) → {To}: {Length} karakter", sms.To[..3] + "*******", sms.Body.Length);
        return Task.FromResult(new SmsResult(true, null, null));
    }
}
