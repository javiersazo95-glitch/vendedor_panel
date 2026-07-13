import React, { useState, useEffect } from 'react';
import { LogOut, PlusCircle, UploadCloud, Database } from 'lucide-react';
import type { Product } from '../db';
import logoImg from '../assets/logo.png';
import { getAllProducts, deleteProduct, addProduct, updateProduct, pauseProduct, resumeProduct } from '../db';
import { KPIs } from './KPIs';
import { Filters } from './Filters';
import { InventoryTable } from './InventoryTable';
import { ManualUpload } from './ManualUpload';
import { BulkUpload } from './BulkUpload';

interface DashboardProps {
  userEmail: string;
  userRole: string;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ userEmail, userRole, onLogout }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'inventory' | 'bulk'>('inventory');
  
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
    } catch (err: any) {
      console.error('Error fetching inventory products:', err);
      setError(err.message || 'Error al obtener el inventario desde el servidor.');
    }
  };

  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
    fetchProducts();
  }, []);

  // 4. Product actions
  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteProduct(id);
      await fetchProducts();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar producto.');
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
    } catch (err: any) {
      alert(err.message || 'Error al actualizar la publicación.');
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

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
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
          <button className={`nav-item ${activeView === 'inventory' ? 'active' : ''}`} onClick={() => setActiveView('inventory')}>
            <Database size={18} />
            Inventario General
          </button>
          
          <button className="nav-item" onClick={() => { setEditingProduct(null); setIsManualOpen(true); }}>
            <PlusCircle size={18} />
            Carga Manual 1:1
          </button>
          
          <button className={`nav-item ${activeView === 'bulk' ? 'active' : ''}`} onClick={() => setActiveView('bulk')}>
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
      <main className={`main-content ${activeView === 'bulk' ? 'main-content-bulk' : ''}`}>
        {/* Top Header Navigation */}
        <header className="top-header">
          <div className="header-title-section">
            <h1>{activeView === 'bulk' ? 'Carga Masiva' : 'Inventario Automotriz'}</h1>
            <p>{activeView === 'bulk' ? 'Carga y validación masiva de stock de repuestos' : 'Monitoreo y carga masiva de stock de repuestos'}</p>
          </div>

          <div className="header-actions">
            {/* Profile Avatar Widget */}
            <div className="user-profile">
              <div className="avatar">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{userEmail}</span>
                <span className="user-role">{userRole}</span>
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

            {/* Main High Density Inventory Table */}
            <InventoryTable
              key={`${searchQuery}-${categoryFilter}-${partBrandFilter}-${vehicleBrandFilter}-${yearFilter}`}
              products={filteredProducts}
              onEdit={handleOpenEditModal}
              onDelete={handleDeleteProduct}
              onTogglePause={handleTogglePauseProduct}
            />
          </>
        )}
      </main>

      {/* Modals & Slide-overs */}
      <ManualUpload
        isOpen={isManualOpen}
        onClose={() => { setIsManualOpen(false); setEditingProduct(null); }}
        onSave={handleSaveProduct}
        editProduct={editingProduct}
      />
    </div>
  );
};
