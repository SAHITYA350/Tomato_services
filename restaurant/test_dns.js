import dns from 'dns';

const domains = [
    'google.com',
    'api.groq.com',
    'integrate.api.nvidia.com',
    'api.tavily.com',
    'github.com'
];

for (const domain of domains) {
    dns.resolve(domain, (err, addresses) => {
        if (err) {
            console.error(`Failed to resolve ${domain}:`, err.message);
        } else {
            console.log(`Resolved ${domain} to:`, addresses);
        }
    });
}
