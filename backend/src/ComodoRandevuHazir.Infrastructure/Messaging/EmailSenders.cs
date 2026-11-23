using System.Collections.Concurrent;
using System.Net;
using System.Net.Mail;
using ComodoRandevuHazir.Application;
using Microsoft.Extensions.Logging;

namespace ComodoRandevuHazir.Infrastructure.Messaging;

/// <summary>Gönderim yapmaz; günlüğe yazar ve son 200 e-postayı bellekte tutar (testler/yerel geliştirme).</summary>
public class SimulatedEmailSender(ILogger<SimulatedEmailSender> log) : IEmailSender
{
    private readonly ConcurrentQueue<EmailMessage> _sent = new();
    public IReadOnlyCollection<EmailMessage> Sent => _sent;

    public Task SendAsync(EmailMessage m, CancellationToken ct)
    {
        _sent.Enqueue(m);
        while (_sent.Count > 200) _sent.TryDequeue(out _);
        // Yerelde kodu görebilmek için gövde de yazılır (gerçek sunucuda SMTP kullanılır).
        log.LogInformation("E-posta (simülasyon) → {To}: {Subject}\n{Body}", m.To, m.Subject, m.Body);
        return Task.CompletedTask;
    }
}

public class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string From { get; set; } = "";
    public bool Ssl { get; set; } = true;
}

/// <summary>Kurumsal e-posta hesabı üzerinden SMTP ile gönderim (Smtp:Host, Port, User, Password, From).</summary>
public class SmtpEmailSender(SmtpOptions o) : IEmailSender
{
    public async Task SendAsync(EmailMessage m, CancellationToken ct)
    {
        using var client = new SmtpClient(o.Host, o.Port) { EnableSsl = o.Ssl, Credentials = new NetworkCredential(o.User, o.Password) };
        using var mail = new MailMessage(string.IsNullOrEmpty(o.From) ? o.User : o.From, m.To, m.Subject, m.Body);
        await client.SendMailAsync(mail, ct);
    }
}
