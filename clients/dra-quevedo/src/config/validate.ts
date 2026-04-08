import { ClientConfigSchema } from '@presenciapro/engine/types';
import { clientConfig } from './client.config';

const result = ClientConfigSchema.safeParse(clientConfig);

if (!result.success) {
  console.error('✗ Config inválida —', clientConfig.client?.id ?? 'id desconocido');
  console.error(result.error.format());
  process.exit(1);
}

console.log('✓ Config válida —', result.data.client.id);
