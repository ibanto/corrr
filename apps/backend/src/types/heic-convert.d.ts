/** heic-convert no trae tipos propios. Solo se usa para las fotos de perfil
 *  del iPhone, que llegan en HEIC aunque la app las etiquete como JPEG. */
declare module 'heic-convert' {
  function heicConvert(options: {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer>;
  export default heicConvert;
}
