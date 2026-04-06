import React from 'react';
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CartItem({ item, onUpdateQuantity, onRemove }) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
        >
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-slate-800 truncate">{item.name}</h4>
                <p className="text-sm text-slate-500">${Number(item.price || 0).toFixed(2)} c/u</p>
            </div>
            
            <div className="flex items-center gap-2">
                <Button
                    size="icon"
                    variant="outline"
                    className="w-7 h-7 rounded-full"
                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                >
                    <Minus className="w-3 h-3" />
                </Button>
                
                <span className="w-8 text-center font-semibold text-slate-800">
                    {item.quantity}
                </span>
                
                <Button
                    size="icon"
                    variant="outline"
                    className="w-7 h-7 rounded-full"
                    onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                >
                    <Plus className="w-3 h-3" />
                </Button>
            </div>
            
            <div className="text-right min-w-[70px]">
                <p className="font-bold text-indigo-600">
                    ${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                </p>
            </div>
            
            <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => onRemove(item.id)}
            >
                <Trash2 className="w-4 h-4" />
            </Button>
        </motion.div>
    );
}