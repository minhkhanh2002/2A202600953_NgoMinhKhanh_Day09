import json
from pathlib import Path
from typing import Any
from langchain_core.tools import tool


class ShoppingDataStore:
    """Student scaffold for mock-data lookup."""

    def __init__(self, json_path: Path) -> None:
        if not json_path.exists():
            raise FileNotFoundError(f"Mock data file not found at {json_path}")
        
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        self.metadata = data.get("metadata", {})
        self.customers = data.get("customers", [])
        self.orders = data.get("orders", [])
        self.vouchers = data.get("vouchers", [])
        
        # Build indexes
        self.customer_by_id = {c["customer_id"]: c for c in self.customers}
        self.order_by_id = {o["order_id"]: o for o in self.orders}
        
        self.orders_by_customer_id = {}
        for o in self.orders:
            cust_id = o["customer_id"]
            if cust_id not in self.orders_by_customer_id:
                self.orders_by_customer_id[cust_id] = []
            self.orders_by_customer_id[cust_id].append(o)
            
        # Sort orders by created_at desc (newest first)
        for cust_id in self.orders_by_customer_id:
            self.orders_by_customer_id[cust_id].sort(
                key=lambda x: x.get("created_at", ""),
                reverse=True
            )
            
        self.vouchers_by_customer_id = {}
        for v in self.vouchers:
            cust_id = v["customer_id"]
            if cust_id not in self.vouchers_by_customer_id:
                self.vouchers_by_customer_id[cust_id] = []
            self.vouchers_by_customer_id[cust_id].append(v)

    def get_customer_by_id(self, customer_id: str) -> dict[str, Any]:
        customer = self.customer_by_id.get(customer_id)
        if customer:
            return {"status": "ok", "customer": customer}
        return {"status": "not_found", "customer_id": customer_id}

    def get_orders_by_customer_id(self, customer_id: str, limit: int = 10) -> dict[str, Any]:
        if customer_id not in self.customer_by_id:
            return {"status": "not_found", "customer_id": customer_id}
            
        orders = self.orders_by_customer_id.get(customer_id, [])
        limited_orders = orders[:limit]
        return {"status": "ok", "orders": limited_orders}

    def get_order_detail_by_order_id(self, order_id: str) -> dict[str, Any]:
        order = self.order_by_id.get(order_id)
        if order:
            return {"status": "ok", "order": order}
        return {"status": "not_found", "order_id": order_id}

    def get_vouchers_by_customer_id(
        self,
        customer_id: str,
        only_active: bool = False,
    ) -> dict[str, Any]:
        if customer_id not in self.customer_by_id:
            return {"status": "not_found", "customer_id": customer_id}
            
        vouchers = self.vouchers_by_customer_id.get(customer_id, [])
        if only_active:
            vouchers = [v for v in vouchers if v.get("status") == "active"]
            
        return {"status": "ok", "vouchers": vouchers}


def build_data_tools(store: ShoppingDataStore) -> list:
    @tool
    def get_customer_by_id(customer_id: str) -> dict[str, Any]:
        """Tra cứu thông tin khách hàng dựa trên customer_id (ví dụ: 'C001').
        Trả về các thông tin cá nhân của khách hàng như tên, hạng thành viên (tier), quota voucher của tháng, email, số điện thoại, v.v.
        """
        return store.get_customer_by_id(customer_id)

    @tool
    def get_orders_by_customer_id(customer_id: str) -> dict[str, Any]:
        """Tra cứu danh sách đơn hàng gần đây của một khách hàng dựa trên customer_id (ví dụ: 'C001').
        Trả về danh sách các đơn hàng của khách hàng đó.
        """
        return store.get_orders_by_customer_id(customer_id)

    @tool
    def get_order_detail_by_order_id(order_id: str) -> dict[str, Any]:
        """Tra cứu thông tin chi tiết của một đơn hàng dựa trên order_id (ví dụ: '1971').
        Trả về chi tiết đơn hàng bao gồm trạng thái vận chuyển, địa chỉ nhận hàng, danh sách sản phẩm trong đơn, v.v.
        """
        return store.get_order_detail_by_order_id(order_id)

    @tool
    def get_vouchers_by_customer_id(customer_id: str) -> dict[str, Any]:
        """Tra cứu danh sách tất cả các voucher khuyến mãi của một khách hàng dựa trên customer_id (ví dụ: 'C001').
        Trả về danh sách voucher cùng trạng thái sử dụng (active, used, expired) của từng voucher.
        """
        return store.get_vouchers_by_customer_id(customer_id, only_active=False)

    return [
        get_customer_by_id,
        get_orders_by_customer_id,
        get_order_detail_by_order_id,
        get_vouchers_by_customer_id,
    ]

