(async function autocompletarCamerfirma() {
  const certId = new URLSearchParams(window.location.search).get('hyperion_id') || prompt('ID de Hyperion:');
  if (!certId) return;

  const API_URL = `http://localhost:4000/api/cliente/${certId}`;

  // Helper para asignar valor y disparar eventos nativos de cambio
  function setInputValue(element: HTMLInputElement | HTMLSelectElement | null, value: string) {
    if (!element) return;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Helper para buscar y seleccionar texto dentro de un <select>
  function setSelectByText(selectElement: HTMLSelectElement | null, textToFind: string) {
    if (!selectElement) return;
    const options = Array.from(selectElement.options) as HTMLOptionElement[];
    const option = options.find(
      (opt) => opt.textContent?.trim().toUpperCase() === textToFind.toUpperCase() || opt.value.toUpperCase() === textToFind.toUpperCase()
    );
    if (option) {
      setInputValue(selectElement, option.value);
    }
  }

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('Error al obtener datos');
    const data = await response.json();

    // 1. Rellenar Datos del Solicitante / Responsable
    setInputValue(document.querySelector<HTMLInputElement>('input[name="nombre"], #nombre'), data.nombre);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="primer_apellido"], #primer_apellido'), data.primerApellido);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="segundo_apellido"], #segundo_apellido'), data.segundoApellido);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="numero_documento"], #num_doc'), data.numDoc);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="email"], #email'), data.email);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="email_confirm"], #email_confirm'), data.email);
    setInputValue(document.querySelector<HTMLInputElement>('input[name="telefono"], #telefono'), data.telefono);

    // 2. Tipo de Documento Identificativo
    const tipoDocSelect = document.querySelector<HTMLSelectElement>('select[name="tipo_documento"]');
    setSelectByText(tipoDocSelect, 'DNI');

    // 3. Ubigeo (Departamento, Provincia, Distrito)
    const depSelect = document.querySelector<HTMLSelectElement>('select[name="departamento"]');
    const provSelect = document.querySelector<HTMLSelectElement>('select[name="provincia"]');
    const distSelect = document.querySelector<HTMLSelectElement>('select[name="distrito"]');

    setSelectByText(depSelect, data.departamento);
    setTimeout(() => {
      setSelectByText(provSelect, data.provincia);
      setTimeout(() => {
        setSelectByText(distSelect, data.distrito);
      }, 300);
    }, 300);

    // 4. Mapeo de Documentación Adjunta
    const docSelect = document.querySelector<HTMLSelectElement>('select[name="tipo_documento_adjunto"]');
    
    if (docSelect && data.documentosAportar.length > 0) {
      const primerDoc = data.documentosAportar[0]; 
      setSelectByText(docSelect, primerDoc.tipoCamerfirma);
      
      console.log(`Seleccionado tipo de documento: ${primerDoc.tipoCamerfirma}`);
      alert(`Paso 1: Se seleccionó '${primerDoc.tipoCamerfirma}' en el combo. Procede a adjuntar su archivo correspondiente.`);
    }

  } catch (error: any) {
    console.error('Error en el autocompletado:', error);
  }
})();