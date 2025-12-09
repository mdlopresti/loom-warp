# Security Policy

## Supported Versions

The NATS MCP Server follows semantic versioning. Only the following versions are currently supported with security updates:

| Version | Supported          |
|---------|--------------------|
| 1.x.x   | Yes                |
| < 1.0   | No                 |

Security updates and patches are provided for the 1.x.x release line. Users are strongly encouraged to keep their installations up to date with the latest available patch.

## Reporting a Vulnerability

Security vulnerabilities should be reported **privately** to maintain the safety of all users while a fix is being developed. Please do **not** open public GitHub issues for security vulnerabilities.

To report a security vulnerability, email:
**mike@lopresti.org**

Include the following information in your report:
- Description of the vulnerability
- Affected version(s)
- Steps to reproduce (if applicable)
- Potential impact assessment
- Any proposed fixes (optional)

## What to Expect

When you report a security vulnerability, you can expect the following timeline:

1. **48 Hour Acknowledgment**: You will receive an acknowledgment that your report has been received within 48 hours of submission.

2. **One Week Assessment**: A security assessment of the reported vulnerability will be completed within one week. You may be asked for clarification or additional information during this period.

3. **30 Day Resolution Goal**: We aim to develop and test a fix within 30 days of the initial report. This timeline may vary depending on the complexity and severity of the vulnerability.

Once a fix is available, a security advisory will be released along with the patched version.

## Security Best Practices for Users

To maximize the security of your NATS MCP Server deployment, we recommend the following practices:

### Communication Security
- **Enable TLS**: Always use TLS encryption for communication with the NATS server and clients. Configure TLS certificates using modern, industry-standard protocols (TLS 1.2 or higher).
- **Certificate Validation**: Ensure client certificates are properly validated and use certificate pinning where appropriate.

### Authentication and Access Control
- **Enable NATS Authentication**: Configure NATS server with authentication enabled. Never run the server with authentication disabled in production environments.
- **Strong Credentials**: Use strong, randomly-generated credentials for all authentication mechanisms.
- **Access Control**: Implement NATS authorization rules to follow the principle of least privilege. Grant only the minimum permissions necessary for each user or service.

### Container Security
- **Non-Root Containers**: Always run the NATS MCP Server container as a non-root user. This limits the impact of potential container breakouts or security vulnerabilities.
- **Read-Only Filesystem**: Where possible, mount the container filesystem as read-only, with only necessary volumes writable.
- **Resource Limits**: Set appropriate CPU and memory limits to prevent resource exhaustion attacks.
- **Security Context**: Use pod security policies or security contexts to enforce additional container hardening.

### Deployment and Operations
- **Keep Software Updated**: Regularly update to the latest patch version of NATS MCP Server to receive security fixes.
- **Monitor Logs**: Monitor application and system logs for suspicious activity or error patterns that may indicate security issues.
- **Network Isolation**: Deploy the server in isolated network segments and restrict network access using firewalls and network policies.
- **Secrets Management**: Use secure secrets management solutions (e.g., Kubernetes Secrets, HashiCorp Vault) for storing credentials and configuration. Never commit secrets to version control.
- **Regular Audits**: Conduct regular security audits of your NATS MCP Server configuration and access patterns.

### Development and Dependencies
- **Dependency Management**: Keep all dependencies up to date and monitor for known vulnerabilities in your supply chain.
- **Code Review**: Conduct code reviews before deploying changes to production.

## Security Research and Bug Bounty

We greatly appreciate the work of security researchers and the broader security community in identifying and responsibly disclosing vulnerabilities.

While we do not currently operate a formal bug bounty program, we recognize and appreciate researchers who:
- Responsibly disclose vulnerabilities
- Provide detailed technical information
- Allow adequate time for assessment and remediation
- Work cooperatively with our team

Researchers who responsibly disclose significant security vulnerabilities may be acknowledged in release notes and security advisories (with permission).

For any questions regarding our security practices or policies, please reach out to mike@lopresti.org.
