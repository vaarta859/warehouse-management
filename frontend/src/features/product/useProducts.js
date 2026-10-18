import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchProducts, selectAllProducts } from "./productSlice";

// Loads the product list (once per mount) and returns it.
// Used by the inward / outward forms for the item dropdowns.
export default function useProducts() {
  const dispatch = useDispatch();
  const products = useSelector(selectAllProducts);

  useEffect(() => {
    dispatch(fetchProducts());
  }, [dispatch]);

  return products;
}
