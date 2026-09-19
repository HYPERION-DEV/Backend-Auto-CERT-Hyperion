import { submitCamerfirmaForm } from '../service/camerfirmaAutomation';

async function main() {
  console.log('🚀 Iniciando prueba de automatización en Camerfirma...');

  try {
    const result = await submitCamerfirmaForm({
      entityType: 'PERSONA_NATURAL',
      documentNumber: '75901183',
      firstNames: 'MIGUEL MARTIN',
      lastName1: 'CONDE',
      lastName2: 'GARCIA',
      email: 'hyperion.desarrollador.mc@gmail.com',
      phone: '923848984',
      address: 'AV REPUBLICA DE PANAMA 3591',
      department: 'LIMA',
      province: 'LIMA',
      district: 'SAN ISIDRO',
    });

    console.log('✅ Prueba finalizada con éxito:', result);
  } catch (error) {
    console.error('❌ Error durante la ejecución:', error);
  }
}

main();