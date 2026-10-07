let input = '';
for await (const chunk of process.stdin) input += chunk;
const { message } = JSON.parse(input);
process.stdout.write(JSON.stringify({ message }));
