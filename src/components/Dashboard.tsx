import React, { useState, useEffect, useMemo } from 'react';
import { LogOut, PlusCircle, UploadCloud, Database, Menu, X, Info, Crown, Grid2X2, List } from 'lucide-react';
import type { Product } from '../db';
import logoImg from '../assets/logo.png';
import { getAllProducts, deleteProduct, addProduct, updateProduct, pauseProduct, resumeProduct, getProductTopSummary, getWalletBalance, setProductTop, type ProductTopSummary } from '../db';
import { KPIs } from './KPIs';
import { Filters } from './Filters';
import { InventoryTable } from './InventoryTable';
import { InventoryGrid } from './InventoryGrid';
import { ManualUpload } from './ManualUpload';
import { BulkUpload } from './BulkUpload';
import { TopModal } from './TopModal';
import { WalletModal } from './WalletModal';
import { RepuestopCoin } from './RepuestopCoin';
import { ordenarInventario, type OrdenInventario } from '../utils/inventoryOrder';

interface DashboardProps {
  userEmail: string;
  userRole: string;
  founder: boolean;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ userEmail, userRole, founder, onLogout }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'inventory' | 'bulk'>('inventory');
  // Sidebar is a fixed 280px column with no responsive behavior before this
  // fix: on tablet/mobile viewports it covered most of the screen and left no
  // usable space for the inventory table (UX-SRC-001). Below 992px it now
  // renders as an off-canvas drawer toggled by this state.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAssigningImages, setIsAssigningImages] = useState(false);
  const [inventoryView, setInventoryView] = useState<'table' | 'grid'>('table');
  const [inventoryOrder, setInventoryOrder] = useState<OrdenInventario>('recomendado');
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  /** Cómo volvió el vendedor de Flow, si es que volvió de Flow. */
  const [rechargeReturn, setRechargeReturn] = useState<'exitosa' | 'pendiente' | null>(null);
  const [topProduct, setTopProduct] = useState<Product | null>(null);
  const [topSummary, setTopSummary] = useState<ProductTopSummary | null>(null);
  const [topLoading, setTopLoading] = useState(false);
  const [topSaving, setTopSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Modals visibility state
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [partBrandFilter, setPartBrandFilter] = useState('');
  const [vehicleBrandFilter, setVehicleBrandFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  // 1. Initialise and load products
  const fetchProducts = async () => {
    setError(null);
    try {
      const list = await getAllProducts();
      const activeList = list.filter((p) => p.activo !== false);
      setProducts(activeList);
      
      // Determine last update timestamp based on product edits
      const times = activeList.map((p) => p.lastUpdated).filter(Boolean) as string[];
      if (times.length > 0) {
        const sorted = times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        setLastUpdated(sorted[0]);
      } else {
        setLastUpdated(null);
      }
    } catch (err: unknown) {
      console.error('Error fetching inventory products:', err);
      setError(err instanceof Error ? err.message : 'Error al obtener el inventario desde el servidor.');
    }
  };

  const refreshWallet = async () => {
    setWalletLoading(true);
    try { const result = await getWalletBalance(); setWalletBalance(result.saldo); }
    catch { /* The Top summary still provides the authoritative balance when available. */ }
    finally { setWalletLoading(false); }
  };

  /**
   * Cupos, costo y máximo de productos Top. El monedero los necesita para decir cuántos Top
   * quedan y cuánto cuesta el próximo, no solo el modal de la estrella.
   */
  const refreshTopSummary = async () => {
    try { const summary = await getProductTopSummary(); setTopSummary(summary); setWalletBalance(summary.saldoMonedas); }
    catch { /* Sin resumen el monedero usa los valores por defecto y el saldo que ya tiene. */ }
  };

  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
    // Standard fetch-on-mount: fetchProducts() only calls setState after its
    // internal awaits resolve, never synchronously in this effect body. The
    // lint rule can't see through the async call, so this is a deliberate,
    // reviewed exception rather than unnoticed debt (QA-SRC-002).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProducts();
    // El saldo es global de la cuenta y debe cargarse igual que el inventario;
    // antes el encabezado quedaba en el valor inicial (0) hasta abrir el popup.
    void refreshWallet();
  }, []);

  /**
   * El regreso desde Flow.
   *
   * El backend termina el pago en una página puente que manda de vuelta acá con `?recarga=`
   * (`PagoController.paginaPuenteRecarga`). Es un parámetro propio y no el `status=success` del
   * pago de un pedido, justamente para que volver de otra cosa no abra el monedero.
   *
   * El parámetro se limpia de la URL apenas se lee: si queda puesto, recargar la página vuelve a
   * celebrar una recarga que ya se celebró.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recarga = params.get('recarga');
    if (recarga !== 'exitosa' && recarga !== 'pendiente') return;
    params.delete('recarga');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRechargeReturn(recarga);
    setWalletOpen(true);
    // Se releen las dos cosas: el saldo lo movió el webhook, y el resumen de Top lleva su propia
    // copia del saldo que si no queda vieja.
    void refreshWallet();
    void refreshTopSummary();
  }, []);

  const openWallet = () => { setWalletOpen(true); void refreshWallet(); void refreshTopSummary(); };

  const openTop = (product: Product) => {
    setTopProduct(product); setTopError(null); setTopLoading(true);
    void getProductTopSummary().then((summary) => { setTopSummary(summary); setWalletBalance(summary.saldoMonedas); })
      .catch((err: unknown) => setTopError(err instanceof Error ? err.message : 'No se pudo consultar productos Top.'))
      .finally(() => setTopLoading(false));
  };

  const handleTopConfirm = async (renew: boolean) => {
    if (!topProduct) return;
    setTopSaving(true); setTopError(null);
    try {
      await setProductTop(topProduct.id, renew);
      setTopProduct(null);
      await Promise.all([fetchProducts(), refreshWallet()]);
    } catch (err) { setTopError(err instanceof Error ? err.message : 'No se pudo actualizar el producto Top.'); }
    finally { setTopSaving(false); }
  };

  // 4. Product actions
  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteProduct(id);
      await fetchProducts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al eliminar producto.');
    }
  };

  const handleTogglePauseProduct = async (product: Product) => {
    try {
      if (product.pausado) {
        await resumeProduct(product.id);
      } else {
        await pauseProduct(product.id);
      }
      await fetchProducts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al actualizar la publicación.');
    }
  };

  const handleSaveProduct = async (
    productData: Omit<Product, 'id' | 'lastUpdated'> & { id?: string },
    imageFiles?: File[] | null
  ) => {
    if (productData.id) {
      // Edit mode
      await updateProduct(productData as Product, imageFiles);
    } else {
      // Create mode
      await addProduct(productData, imageFiles);
    }
    await fetchProducts();
  };

  const handleQuickUpdateProduct = async (
    product: Product,
    updates: { price?: number; stock?: number }
  ) => {
    const updatedProduct: Product = {
      ...product,
      price: updates.price !== undefined ? updates.price : product.price,
      stock: updates.stock !== undefined ? updates.stock : product.stock,
    };
    await updateProduct(updatedProduct);
    await fetchProducts();
  };

  const handleOpenEditModal = (product: Product) => {
    setEditingProduct(product);
    setIsManualOpen(true);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('');
    setPartBrandFilter('');
    setVehicleBrandFilter('');
    setYearFilter('');
  };

  // 5. Client-side filtering logic
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      !searchQuery ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.oem && p.oem.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = !categoryFilter || p.category === categoryFilter;
    const matchesPartBrand = !partBrandFilter || p.partBrand === partBrandFilter;
    const matchesVehicleBrand = !vehicleBrandFilter || p.vehicleBrand === vehicleBrandFilter;
    const matchesYear = !yearFilter || String(p.vehicleYear) === yearFilter;

    return matchesSearch && matchesCategory && matchesPartBrand && matchesVehicleBrand && matchesYear;
  });

  /**
   * El orden de la lista.
   *
   * Antes no había ninguno: se mostraba el orden en que el backend devolvía los productos
   * (`updatedAt DESC`), o sea arriba quedaba lo último que el vendedor tocó. El orden recomendado
   * pone adelante lo que cuesta plata -- los Top, primero el vencido y después el que está por
   * vencer -- y lo que no se puede vender. Las reglas viven en `utils/inventoryOrder.ts`.
   */
  const { productos: sortedProducts, grupos: inventoryGroups } = useMemo(
    () => ordenarInventario(filteredProducts, inventoryOrder),
    // `filteredProducts` se recalcula en cada render, así que las dependencias son lo que de
    // verdad lo determina; con el array mismo, el memo no serviría de nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, searchQuery, categoryFilter, partBrandFilter, vehicleBrandFilter, yearFilter, inventoryOrder],
  );

  const closeSidebarOnMobile = () => setIsSidebarOpen(false);

  return (
    <div className="app-container">
      {isSidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebarOnMobile} />}

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''} ${isAssigningImages ? 'sidebar-hidden' : ''}`}>
        <div className="logo-container" style={{ margin: '0.5rem 0 2.5rem 0', justifyContent: 'center' }}>
          <img
            src={logoImg}
            alt="RepuesTop"
            style={{
              height: '75px',
              width: 'auto',
              objectFit: 'contain'
            }}
            className="logo-sidebar-img"
          />
        </div>

        <nav className="nav-links">
          <button className={`nav-item ${activeView === 'inventory' ? 'active' : ''}`} onClick={() => { setActiveView('inventory'); closeSidebarOnMobile(); }}>
            <Database size={18} />
            Inventario General
          </button>

          <button className="nav-item" onClick={() => { setEditingProduct(null); setIsManualOpen(true); closeSidebarOnMobile(); }}>
            <PlusCircle size={18} />
            Carga Manual 1:1
          </button>

          <button className={`nav-item ${activeView === 'bulk' ? 'active' : ''}`} onClick={() => { setActiveView('bulk'); closeSidebarOnMobile(); }}>
            <UploadCloud size={18} />
            Carga Masiva
          </button>
        </nav>

        <div className="sidebar-footer">


          <button className="nav-item" onClick={onLogout} style={{ color: 'hsl(var(--danger))' }}>
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Panel Content Area */}
      <main className={`main-content ${activeView === 'bulk' ? 'main-content-bulk' : ''} ${isAssigningImages ? 'hide-sidebar' : ''}`}>
        {/* Top Header Navigation */}
        <header className="top-header">
          <div className="header-title-section" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setIsSidebarOpen((open) => !open)}
              aria-label={isSidebarOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
              aria-expanded={isSidebarOpen}
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div>
              <h1>Panel de gestión masiva del vendedor</h1>
              <p>{activeView === 'bulk'
                ? 'Publica y actualiza cientos de repuestos a la vez desde una sola plantilla.'
                : 'Administra todo tu inventario y realiza cargas masivas. Cada cambio se sincroniza al instante con la plataforma web y la app móvil.'}</p>
            </div>
          </div>

          <div className="header-actions">
            <button type="button" className="wallet-header-button" onClick={openWallet} aria-label="Abrir monedero RepuesTop">
              <RepuestopCoin size={42} /><span>{walletLoading ? '…' : walletBalance.toLocaleString('es-CL')}</span><small>monedas</small>
            </button>
            {/* Profile Avatar Widget */}
            <div className="user-profile">
              <div className="avatar">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{userEmail}</span>
                <span className="user-role">{userRole}</span>
                {founder ? <span className="founder-badge-web"><Crown size={13} className="founder-crown-icon" /> Fundador <button type="button" className="founder-info" aria-label="Información sobre Vendedor Fundador"><Info size={13} /><span className="founder-tooltip">Confiaste en RepuesTop antes del lanzamiento. Tu comisión RepuesTop es fija en 5%; el IVA y Flow se mantienen.</span></button></span> : null}
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div 
            style={{ 
              background: '#fef2f2', 
              border: '1px solid #fee2e2', 
              borderRadius: '12px', 
              color: '#ef4444', 
              padding: '0.85rem 1.25rem', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 4px rgba(239, 68, 68, 0.05)'
            }}
          >
            <span>{error}</span>
            <button 
              onClick={fetchProducts} 
              className="btn btn-secondary" 
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: 'auto' }}
            >
              Reintentar
            </button>
          </div>
        )}

        {activeView === 'bulk' ? (
          <BulkUpload
            isOpen={activeView === 'bulk'}
            onClose={() => setActiveView('inventory')}
            onUploadSuccess={fetchProducts}
            onAssignImagesStateChange={(isAssigning) => setIsAssigningImages(isAssigning)}
            embedded
          />
        ) : (

          <>
            {/* Dashboard Metrics (KPIs) */}
            <KPIs products={products} lastUpdated={lastUpdated} />

            {/* Filters Bar Control */}
            <Filters
              products={products}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              partBrandFilter={partBrandFilter}
              setPartBrandFilter={setPartBrandFilter}
              vehicleBrandFilter={vehicleBrandFilter}
              setVehicleBrandFilter={setVehicleBrandFilter}
              yearFilter={yearFilter}
              setYearFilter={setYearFilter}
              onClearFilters={handleClearFilters}
            />

            <div className="inventory-view-toolbar">
              <div><strong>Vista de inventario</strong><span>{sortedProducts.length.toLocaleString('es-CL')} repuestos encontrados</span></div>
              {/* La salida para el día de la carga masiva: recién subidas 150 filas, lo que el
                  vendedor quiere ver es lo que acaba de subir, no sus productos Top. */}
              <label className="inventory-order-select">
                Ordenar por
                <select value={inventoryOrder} onChange={(event) => setInventoryOrder(event.target.value as OrdenInventario)}>
                  <option value="recomendado">Recomendado</option>
                  <option value="reciente">Última modificación</option>
                </select>
              </label>
              <div className="inventory-view-switch" role="group" aria-label="Cambiar vista de inventario">
                <button type="button" className={inventoryView === 'table' ? 'active' : ''} onClick={() => setInventoryView('table')} aria-pressed={inventoryView === 'table'} title="Vista de tabla"><List size={17} /> Tabla</button>
                <button type="button" className={inventoryView === 'grid' ? 'active' : ''} onClick={() => setInventoryView('grid')} aria-pressed={inventoryView === 'grid'} title="Vista de cuadrícula"><Grid2X2 size={17} /> Cuadrícula</button>
              </div>
            </div>

            {/* Main High Density Inventory Table */}
            {inventoryView === 'table' ? <InventoryTable
              key={`${searchQuery}-${categoryFilter}-${partBrandFilter}-${vehicleBrandFilter}-${yearFilter}-${inventoryOrder}`}
              products={sortedProducts}
              grupos={inventoryGroups}
              onEdit={handleOpenEditModal}
              onDelete={handleDeleteProduct}
              onTogglePause={handleTogglePauseProduct}
              onManageTop={openTop}
              onQuickUpdate={handleQuickUpdateProduct}
            /> : <InventoryGrid products={sortedProducts} grupos={inventoryGroups} onEdit={handleOpenEditModal} onDelete={handleDeleteProduct} onTogglePause={handleTogglePauseProduct} onManageTop={openTop} />}
          </>
        )}
      </main>

      {/* Modals & Slide-overs */}
      <ManualUpload
        isOpen={isManualOpen}
        onClose={() => { setIsManualOpen(false); setEditingProduct(null); }}
        onSave={handleSaveProduct}
        editProduct={editingProduct}
        founder={founder}
      />
      <TopModal product={topProduct} visible={!walletOpen} summary={topSummary} loading={topLoading} saving={topSaving} error={topError} onClose={() => !topSaving && setTopProduct(null)} onConfirm={handleTopConfirm} onRecharge={openWallet} />
      {walletOpen && <WalletModal
        balance={walletBalance}
        loading={walletLoading}
        summary={topSummary}
        celebrar={rechargeReturn === 'exitosa'}
        pendiente={rechargeReturn === 'pendiente'}
        onCelebracionLista={() => setRechargeReturn(null)}
        onBalance={setWalletBalance}
        onClose={() => { setWalletOpen(false); setRechargeReturn(null); }}
      />}
    </div>
  );
};
