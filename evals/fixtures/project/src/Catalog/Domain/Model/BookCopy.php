<?php

declare(strict_types=1);

namespace Catalog\Domain\Model;

use Catalog\Domain\Enum\BookCopyStatus;
use Catalog\Domain\Model\Embeddable\Location;
use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\ORM\Mapping as ORM;
use Library\Domain\Model\Library;

#[ORM\Entity]
#[ORM\Table(name: 'book_copy')]
#[ORM\UniqueConstraint(name: 'uniq_book_copy_call_number', columns: ['call_number'])]
class BookCopy
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\ManyToOne(targetEntity: Book::class, inversedBy: 'bookCopies')]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Book $book;

    #[ORM\ManyToOne(targetEntity: Library::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Library $library;

    #[ORM\Column(length: 32)]
    public private(set) string $callNumber;

    #[ORM\Embedded(class: Location::class)]
    public private(set) Location $location;

    #[ORM\Column(length: 20, enumType: BookCopyStatus::class)]
    public private(set) BookCopyStatus $status;

    public function __construct(Book $book, Library $library, string $callNumber, Location $location)
    {
        $this->book = $book;
        $this->library = $library;
        $this->callNumber = $callNumber;
        $this->location = $location;
        $this->status = BookCopyStatus::Available;
    }

    public function borrow(): void
    {
        if (BookCopyStatus::Available !== $this->status) {
            throw new \LogicException('Only an available book copy can be borrowed.');
        }

        $this->status = BookCopyStatus::Borrowed;
    }

    public function return(): void
    {
        if (BookCopyStatus::Borrowed !== $this->status) {
            throw new \LogicException('Only a borrowed book copy can be returned.');
        }

        $this->status = BookCopyStatus::Available;
    }

    public function withdraw(): void
    {
        if (BookCopyStatus::Withdrawn === $this->status) {
            throw new \LogicException('This book copy is already withdrawn from the catalog.');
        }

        $this->status = BookCopyStatus::Withdrawn;
    }

    public function move(Location $location): void
    {
        $this->location = $location;
    }
}
