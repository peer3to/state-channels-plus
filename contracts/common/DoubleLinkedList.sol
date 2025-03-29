pragma solidity ^0.8.0;
// import "hardhat/console.sol";

struct NodeData {
    bytes32 tableId;
}
struct Node {
    NodeData data;
    bytes32 uniquePtr;
    bytes32 next;
    bytes32 prev;
}
contract InternalDoubleLinkedListIterator{
    
    function createIterator(DoubleLinkedList list) internal view returns (DoubleLinkedListIterator memory) {
        Node memory current = list.getAtIndex(0);
        return DoubleLinkedListIterator(list, current);
    }
    
    function iteratorNext(DoubleLinkedListIterator memory iterator) internal view returns (Node memory) {
        iterator.current = iterator.list.getNode(iterator.current.next);
        return iterator.current;
    }

    function iteratorPrev(DoubleLinkedListIterator memory iterator) internal view returns (Node memory) {
        iterator.current = iterator.list.getNode(iterator.current.prev);
        return iterator.current;
    }
    function iteratorGetCurrent(DoubleLinkedListIterator memory iterator) internal pure returns (Node memory) {
        return iterator.current;
    }
    function iteratorReset(DoubleLinkedListIterator memory iterator) internal view {
        iterator.current = iterator.list.getAtIndex(0);
    }

}

struct DoubleLinkedListIterator{
    DoubleLinkedList list;
    Node current;
}

contract DoubleLinkedList {

    uint public length = 0;
    mapping(bytes32 => Node) private map;
    Node headNode = Node(NodeData(0), 0, 0, 0);
    // Add data to the front of the list
    function addFront(NodeData memory data) public {
        Node memory node = Node(data, data.tableId, 0, 0);
        node.next = headNode.uniquePtr;
        node.prev = 0;
        map[node.uniquePtr] = node;

        //This is important to access and modify the storage of uniquePtr and not headNode - this way everything remains linked while persisted
        Node storage currentHead = map[headNode.uniquePtr];
        //This would fail in other programing languages
        if (currentHead.uniquePtr != 0) {
            currentHead.prev = node.uniquePtr;
        }
        headNode = node;
        length++;
    }

    function removeNode(bytes32 uniquePtr) public {
        Node memory node = map[uniquePtr];
        if (node.prev != 0) {
            map[node.prev].next = node.next;
        }
        if (node.next != 0) {
            map[node.next].prev = node.prev;
        }
        if (node.prev == 0) {
            headNode = map[node.next];
        }
        delete map[uniquePtr];
        length--;
    }

    function removeFront() public {
        removeNode(headNode.uniquePtr);
    }

    function getNode(bytes32 uniquePtr) public view returns (Node memory) {
        return map[uniquePtr];
    }

    function getAtIndex(uint index) public view returns (Node memory) {
        require(index < length, "Index out of bounds");
        bytes32 current = headNode.uniquePtr;
        for (uint i = 0; i < index; i++) {
            current = map[current].next;
        }
        return map[current];
    }

    function printAll() public view {
        bytes32 current = headNode.uniquePtr;
        for (uint i = 0; i < length; i++) {
            Node memory node = map[current];
            // console.logBytes32(node.data.tableId);
            current = node.next;
        }
    }
    // Get data from the list by index
    // The caller needs to know the type of data and decode it accordingly
    // function get(uint index) public view returns (bytes memory) {
    //     require(index < length, "Index out of bounds");

    //     uint current = head;
    //     for (uint i = 0; i < index; i++) {
    //         current = nodes[current].next;
    //     }

    //     return nodes[current].data;
    // }
}
