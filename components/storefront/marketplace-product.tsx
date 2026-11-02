"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { StoreImage } from "@/components/storefront/store-image";
import type { StoreProduct } from "@/components/storefront/store-types";
import { formatStorePrice } from "@/modules/storefront/pricing";
import s from "./marketplace.module.css";

export function MarketplaceProduct({
  product,
  quantity,
  related,
  onBack,
  onAdd,
  onDecrease,
  onOpenProduct,
}: {
  product: StoreProduct;
  quantity: number;
  related: StoreProduct[];
  onBack: () => void;
  onAdd: (product: StoreProduct) => void;
  onDecrease: (productId: string) => void;
  onOpenProduct: (product: StoreProduct) => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const images = product.imageUrls;
  const buyTogether = related.filter((item) => item.inStock && item.id !== product.id).slice(0, 3);
  const buyIds = new Set(buyTogether.map((item) => item.id));
  const recommendations = related.filter((item) => item.id !== product.id && !buyIds.has(item.id)).slice(0, 4);
  const chosen = buyTogether.filter((item) => selected.includes(item.id));
  const togetherTotal = product.price + chosen.reduce((sum, item) => sum + item.price, 0);

  function addSelected() {
    if (product.inStock) onAdd(product);
    for (const item of chosen) onAdd(item);
  }

  return (
    <article className={s.detail}>
      <div className={s.gallery}>
        <div className={s.galleryStage}>
          <StoreImage src={images[index] ?? null} alt={product.name} sizes="(max-width: 899px) 100vw, 720px" preload />
          {images.length > 1 ? (
            <>
              <button type="button" className={s.galleryNav} style={{ left: 8 }} disabled={index === 0} aria-label="Previous photo" onClick={() => setIndex(index - 1)}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" className={s.galleryNav} style={{ right: 8 }} disabled={index === images.length - 1} aria-label="Next photo" onClick={() => setIndex(index + 1)}>
                <ChevronRight size={18} />
              </button>
            </>
          ) : null}
        </div>
        {images.length > 1 ? (
          <div className={s.thumbs}>
            {images.map((url, imageIndex) => (
              <button key={url} type="button" aria-label={`Show photo ${imageIndex + 1}`} aria-current={imageIndex === index} onClick={() => setIndex(imageIndex)}>
                <StoreImage src={url} alt="" sizes="64px" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={s.detailCopy}>
        <button type="button" className={s.filterButton} onClick={onBack}>Back to shop</button>
        <h1 className="mt-3">{product.name}</h1>
        <div className={`${s.price} mt-2`}>
          <span>{formatStorePrice(product.price)}</span>
          {product.compareAtPrice && product.compareAtPrice > product.price ? <del>{formatStorePrice(product.compareAtPrice)}</del> : null}
        </div>
        <p className={s.saving}>{!product.inStock ? "Out of stock" : product.discountPercent ? `${product.discountPercent}% off` : `${product.onHand} in stock`}</p>
        {product.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-600">{product.description}</p> : null}
        <div className={s.meta}>
          <p><strong>Payment.</strong> {[product.prepaidEnabled ? "Prepaid" : null, product.codEnabled ? (product.codAdvancePercent ? `Cash on delivery with ${product.codAdvancePercent}% advance` : "Cash on delivery") : null].filter(Boolean).join(" · ") || "Ask the merchant"}</p>
          <p><strong>Returns.</strong> {product.returnAvailable === false ? "No return" : "Return available"}</p>
        </div>
        {buyTogether.length ? (
          <section className={s.buy} aria-label="Buy together">
            <h2 className="text-sm font-semibold">Buy together</h2>
            <p className="text-xs text-zinc-500">Each item is added at its current price.</p>
            {buyTogether.map((item) => (
              <div key={item.id} className={s.buyRow}>
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  checked={selected.includes(item.id)}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
                />
                <span className={s.buyThumb}><StoreImage src={item.imageUrls[0]} alt="" sizes="44px" /></span>
                <span className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left text-sm font-medium" onClick={() => onOpenProduct(item)}>{item.name}</button>
                  <span className="text-xs">{formatStorePrice(item.price)}</span>
                </span>
              </div>
            ))}
          </section>
        ) : null}
        <div className={s.purchase}>
          <p>{chosen.length ? `${chosen.length + 1} items · ${formatStorePrice(togetherTotal)}` : formatStorePrice(product.price)}</p>
          {quantity > 0 && !chosen.length ? (
            <div className={s.stepper}>
              <button type="button" aria-label={`Decrease ${product.name}`} onClick={() => onDecrease(product.id)}><Minus size={16} /></button>
              <span>{quantity}</span>
              <button type="button" aria-label={`Increase ${product.name}`} disabled={quantity >= product.onHand} onClick={() => onAdd(product)}><Plus size={16} /></button>
            </div>
          ) : (
            <button type="button" className={s.add} disabled={!product.inStock} onClick={chosen.length ? addSelected : () => onAdd(product)}>
              {chosen.length ? "Add selected" : product.inStock ? "Add to cart" : "Unavailable"}
            </button>
          )}
        </div>
        {recommendations.length ? (
          <section className={`${s.section} border-0`}>
            <div className={s.sectionHead}><h2>You may also like</h2></div>
            <div className={s.rail}>
              {recommendations.map((item) => (
                <article key={item.id} className={s.product}>
                  <button type="button" className={s.productImage} aria-label={`View ${item.name}`} onClick={() => onOpenProduct(item)}>
                    <StoreImage src={item.imageUrls[0]} alt={item.name} sizes="180px" />
                  </button>
                  <div className={s.productBody}>
                    <button type="button" className={s.productName} onClick={() => onOpenProduct(item)}>{item.name}</button>
                    <div className={s.price}>{formatStorePrice(item.price)}</div>
                    <button type="button" className={s.add} disabled={!item.inStock} onClick={() => onAdd(item)}>Add</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}
