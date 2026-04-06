import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Package } from "lucide-react";
import { motion } from "framer-motion";

export default function ProductCard({ product, onAdd }) {
    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
        >
            <Card 
                className="cursor-pointer overflow-hidden border-0 shadow-sm hover:shadow-lg transition-all duration-300 bg-white"
                onClick={() => onAdd(product)}
            >
                <div className="aspect-square relative bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden">
                    {product.image_url ? (
                        <img 
                            src={product.image_url} 
                            alt={product.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Package className="w-12 h-12 text-slate-300" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
                </div>
                <CardContent className="p-4">
                    <h3 className="font-semibold text-slate-800 truncate">{product.name}</h3>
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-xl font-bold text-indigo-600">
                            ${Number(product.price || 0).toFixed(2)}
                        </span>
                        <Button 
                            size="sm" 
                            className="rounded-full w-8 h-8 p-0 bg-indigo-600 hover:bg-indigo-700"
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                        Stock: {product.stock || 0}
                    </p>
                </CardContent>
            </Card>
        </motion.div>
    );
}