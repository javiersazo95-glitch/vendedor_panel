import React, { useEffect, useState } from 'react';
import { FullCreationUpload } from './FullCreationUpload';
import { ExpressUpload } from './ExpressUpload';

interface BulkUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
  /**
   * Un cambio de precios y stock que terminó sin una sola fila fuera.
   *
   * Sólo ese caso avisa: si algo quedó fuera, el vendedor tiene que ver acá qué código no se
   * actualizó, y mandarlo al inventario con un cartel verde escondería justamente eso.
   */
  onExpressSuccess?: (cargados: number) => void;
  /**
   * Con qué pestaña abre. "history" sólo llega desde el "Ver detalle" del aviso de un cambio
   * de precios y stock, así que abre ese historial.
   */
  initialTab?: 'upload' | 'history';
  embedded?: boolean;
}

/**
 * Entrada de la carga masiva: Publicación Completa (FullCreationUpload) o "Cambiar precios y
 * stock" (ExpressUpload). Fase 6 del plan de auditoría de carga: el modo Express vivía aquí
 * mismo, en 2.400 líneas que mezclaban el parser viejo de la publicación completa (ya migrada
 * al backend en la Fase 9), un modal "Editar SKU" que rechazaba los SKU que sí existían y un
 * historial guardado sólo en el navegador. Ahora cada modo es un componente propio.
 */
export const BulkUpload: React.FC<BulkUploadProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onExpressSuccess,
  initialTab = 'upload',
  embedded = false,
}) => {
  const [modo, setModo] = useState<'FULL_CREATION' | 'EXPRESS'>(initialTab === 'history' ? 'EXPRESS' : 'FULL_CREATION');

  // El historial viejo vivía en este navegador (con nombres y precios de productos) y ya no se
  // lee: el historial está en el backend. Se borra para no dejar esos datos guardados.
  useEffect(() => {
    try {
      localStorage.removeItem('repuestop_bulk_upload_history');
    } catch {
      // Navegador sin almacenamiento: no hay nada que borrar.
    }
  }, []);

  if (!isOpen) return null;

  if (modo === 'EXPRESS') {
    return (
      <ExpressUpload
        isOpen={isOpen}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
        onExpressSuccess={onExpressSuccess}
        onSwitchToFull={() => setModo('FULL_CREATION')}
        initialTab={initialTab}
        embedded={embedded}
      />
    );
  }

  return (
    <FullCreationUpload
      isOpen={isOpen}
      onClose={onClose}
      onUploadSuccess={onUploadSuccess}
      embedded={embedded}
      onSwitchToExpress={() => setModo('EXPRESS')}
    />
  );
};
