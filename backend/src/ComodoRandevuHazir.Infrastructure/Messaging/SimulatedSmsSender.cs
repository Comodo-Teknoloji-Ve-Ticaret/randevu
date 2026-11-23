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

    public Task SendAsync(string to, string body, CancellationToken ct)
    {
        _sent.Enqueue(new OutgoingSms(to, body));
        while (_sent.Count > 500) _sent.TryDequeue(out _);
        log.LogInformation("SMS (simülasyon) → {To}: {Length} karakter", to[..3] + "*******", body.Length);
        return Task.CompletedTask;
    }
}
